import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { ArrowRight, CreditCard, Plus, Pencil, Trash2, ChevronDown, ChevronUp, DollarSign, AlertTriangle } from 'lucide-react'
import { RevenueIcon } from '@/components/icons'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

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
    if (editId) {
      await supabase.from('branch_credit_customers').update(payload).eq('id', editId)
    } else {
      await supabase.from('branch_credit_customers').insert(payload)
    }
    resetForm()
    setTab('list')
    await fetchCustomers()
  }

  async function deleteCustomer(id: number) {
    if (!confirm('למחוק לקוח?')) return
    await supabase.from('branch_credit_customers').delete().eq('id', id)
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
    await supabase.from('branch_credit_payments').insert({
      branch_id: branchId,
      customer_name: customerName,
      date: payDate,
      amount: parseFloat(payAmount),
      notes: payNotes || null,
    })
    setPayAmount(''); setPayNotes('')
    const customer = customers.find(c => c.name === customerName)
    if (customer) await fetchDetails(customer)
    await fetchCustomers()
  }

  const totalDebt = Object.values(balances).reduce((s, v) => s + Math.max(v, 0), 0)

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* כותרת */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <RevenueIcon size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>לקוחות הקפה — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>ניהול חובות · היסטוריה · תשלומים</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
          {totalDebt > 0 && (
            <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={16} color="#fb7185" />
              <div>
                <div style={{ fontSize: '15px', fontWeight: '800', color: '#fb7185' }}>₪{Math.round(totalDebt).toLocaleString()}</div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>סה"כ חוב פתוח</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* טאבים */}
      <div className="flex px-8 bg-white border-b border-slate-200">
        <button onClick={() => { setTab('list'); resetForm() }}
          className={`py-3.5 px-5 bg-transparent border-none cursor-pointer text-sm ${tab === 'list' ? 'font-bold' : 'font-medium'}`}
          style={{ borderBottom: tab === 'list' ? `3px solid ${branchColor}` : '3px solid transparent', color: tab === 'list' ? branchColor : '#64748b' }}>
          רשימת לקוחות
        </button>
        <button onClick={() => { setTab('add'); if (!editId) resetForm() }}
          className={`py-3.5 px-5 bg-transparent border-none cursor-pointer text-sm ${tab === 'add' ? 'font-bold' : 'font-medium'}`}
          style={{ borderBottom: tab === 'add' ? `3px solid ${branchColor}` : '3px solid transparent', color: tab === 'add' ? branchColor : '#64748b' }}>
          {editId ? 'עריכת לקוח' : 'הוספת לקוח'}
        </button>
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '900px', margin: '0 auto' }}>

        {/* רשימה */}
        {tab === 'list' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <div className="table-scroll">
              <Card className="shadow-sm">
                <CardContent className="p-6">
                  {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>טוען...</div>
                  ) : customers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
                      <CreditCard size={40} color="#e2e8f0" style={{ marginBottom: '12px' }} />
                      <div style={{ fontSize: '15px', fontWeight: '600' }}>אין לקוחות הקפה</div>
                      <div style={{ fontSize: '13px', marginTop: '4px' }}>הוסף לקוח חדש בטאב "הוספת לקוח"</div>
                    </div>
                  ) : (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
                      {customers.map((c, i) => {
                        const balance = balances[c.id] || 0
                        const isExp = expanded === c.id
                        return (
                          <div key={c.id}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px 36px 36px 30px', alignItems: 'center', padding: '14px 16px', borderBottom: (i < customers.length - 1 || isExp) ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                              onClick={() => toggleExpand(c)}>
                              <div>
                                <div style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{c.name}</div>
                                {c.phone && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.phone}</div>}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                {c.credit_limit > 0 && (
                                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>מסגרת: ₪{c.credit_limit.toLocaleString()}</div>
                                )}
                              </div>
                              <div style={{ textAlign: 'left' as const }}>
                                <span style={{ fontSize: '15px', fontWeight: '800', color: balance > 0 ? '#fb7185' : '#34d399' }}>
                                  ₪{Math.round(Math.abs(balance)).toLocaleString()}
                                </span>
                                <div style={{ fontSize: '10px', color: '#94a3b8' }}>{balance > 0 ? 'חוב' : balance < 0 ? 'יתרה לזכות' : 'מאוזן'}</div>
                              </div>
                              <button onClick={e => { e.stopPropagation(); startEdit(c) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                <Pencil size={14} color="#94a3b8" />
                              </button>
                              <button onClick={e => { e.stopPropagation(); deleteCustomer(c.id) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                <Trash2 size={14} color="#fb7185" />
                              </button>
                              {isExp ? <ChevronUp size={16} color="#64748b" /> : <ChevronDown size={16} color="#64748b" />}
                            </div>

                            {/* expanded: history + payment */}
                            {isExp && (
                              <div style={{ padding: '16px 20px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>

                                {/* payment form */}
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', alignItems: 'flex-end', flexWrap: 'wrap' as const }}>
                                  <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                                    <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>תאריך</label>
                                    <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                                      style={{ ...S.input, width: '140px', padding: '7px 10px', fontSize: '13px' }} />
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                                    <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>סכום תשלום (₪)</label>
                                    <input type="number" placeholder="0" value={payAmount} onChange={e => setPayAmount(e.target.value)}
                                      style={{ ...S.input, width: '120px', padding: '7px 10px', fontSize: '13px', textAlign: 'right' as const }} />
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column' as const, flex: 1 }}>
                                    <label style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', marginBottom: '4px' }}>הערה</label>
                                    <input type="text" placeholder="אופציונלי" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                                      style={{ ...S.input, padding: '7px 10px', fontSize: '13px' }} />
                                  </div>
                                  <button onClick={() => addPayment(c.name)} disabled={!payAmount || parseFloat(payAmount) <= 0}
                                    style={{ background: payAmount && parseFloat(payAmount) > 0 ? '#34d399' : '#e2e8f0', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' as const }}>
                                    <DollarSign size={14} />רשום תשלום
                                  </button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                  {/* עסקאות הקפה */}
                                  <div>
                                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#fb7185', marginBottom: '6px' }}>עסקאות הקפה</div>
                                    {txs.length === 0 ? (
                                      <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px' }}>אין עסקאות</div>
                                    ) : (
                                      <div style={{ maxHeight: '180px', overflowY: 'auto' as const, border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white' }}>
                                        {txs.map(tx => (
                                          <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}>
                                            <span style={{ color: '#64748b' }}>{new Date(tx.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                                            <span style={{ fontWeight: '600', color: '#fb7185' }}>₪{Number(tx.amount).toLocaleString()}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* תשלומים */}
                                  <div>
                                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#34d399', marginBottom: '6px' }}>תשלומים</div>
                                    {payments.length === 0 ? (
                                      <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px' }}>אין תשלומים</div>
                                    ) : (
                                      <div style={{ maxHeight: '180px', overflowY: 'auto' as const, border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white' }}>
                                        {payments.map(p => (
                                          <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: '12px' }}>
                                            <span style={{ color: '#64748b' }}>
                                              {new Date(p.date + 'T12:00:00').toLocaleDateString('he-IL')}
                                              {p.notes && <span style={{ color: '#94a3b8', marginRight: '6px' }}>({p.notes})</span>}
                                            </span>
                                            <span style={{ fontWeight: '600', color: '#34d399' }}>₪{Number(p.amount).toLocaleString()}</span>
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
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </motion.div>
        )}

        {/* הוספה/עריכה */}
        {tab === 'add' && (
          <motion.div variants={fadeIn} initial="hidden" animate="visible">
            <Card className="shadow-sm">
              <CardContent className="p-6">
                <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>
                  {editId ? 'עריכת לקוח' : 'הוספת לקוח הקפה חדש'}
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
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
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={saveCustomer} disabled={!formName.trim()}
                    style={{ background: formName.trim() ? branchColor : '#e2e8f0', color: formName.trim() ? 'white' : '#94a3b8', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Plus size={18} />{editId ? 'עדכן' : 'הוסף לקוח'}
                  </button>
                  {editId && (
                    <button onClick={() => { resetForm(); setTab('list') }}
                      style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', padding: '10px 20px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                      ביטול
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

      </div>
    </div>
  )
}
