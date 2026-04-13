import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search, ChevronLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/PageHeader'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { branchId: number; branchName: string; branchColor: string; onBack: () => void }

interface Invoice {
  id: number; customer_id: number; invoice_number: string | null
  invoice_date: string; due_date: string | null
  total_before_vat: number; total_with_vat: number; status: string
  customer_name?: string; paid_amount?: number
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'פתוח', color: '#a16207', bg: '#fefce8' },
  partial: { label: 'חלקי', color: '#7c3aed', bg: '#faf5ff' },
  paid: { label: 'שולם', color: '#166534', bg: '#f0fdf4' },
  overdue: { label: 'באיחור', color: '#dc2626', bg: '#fef2f2' },
}

const S = {
  card: { background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  input: { border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const, outline: 'none' } as React.CSSProperties,
}
const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()
const fmtDate = (d: string) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function BranchB2BHistory({ branchId, branchName, branchColor, onBack }: Props) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(getCurrentMonth())
  const [search, setSearch] = useState('')
  const [viewCustomer, setViewCustomer] = useState<{ id: number; name: string } | null>(null)
  const [custInvoices, setCustInvoices] = useState<Invoice[]>([])

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const last = new Date(y, m, 0).getDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`

    const { data } = await supabase.from('b2b_invoices')
      .select('*, b2b_customers(name)')
      .eq('branch_id', branchId)
      .gte('invoice_date', from).lte('invoice_date', to)
      .order('invoice_date', { ascending: false })

    const invs = (data || []).map((inv: any) => ({ ...inv, customer_name: inv.b2b_customers?.name || '?' }))

    // Get paid amounts
    const ids = invs.map((i: any) => i.id)
    if (ids.length > 0) {
      const { data: pays } = await supabase.from('b2b_payments').select('invoice_id, amount').in('invoice_id', ids)
      const payMap = new Map<number, number>()
      for (const p of (pays || [])) payMap.set(p.invoice_id, (payMap.get(p.invoice_id) || 0) + Number(p.amount))
      for (const inv of invs) inv.paid_amount = payMap.get(inv.id) || 0
    }

    setInvoices(invs)
    setLoading(false)
  }, [branchId, month])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  async function openCustomer(custId: number, custName: string) {
    setViewCustomer({ id: custId, name: custName })
    const { data } = await supabase.from('b2b_invoices')
      .select('*, b2b_customers(name)')
      .eq('branch_id', branchId).eq('customer_id', custId)
      .order('invoice_date', { ascending: false })
    const invs = (data || []).map((inv: any) => ({ ...inv, customer_name: inv.b2b_customers?.name || '?' }))
    const ids = invs.map((i: any) => i.id)
    if (ids.length > 0) {
      const { data: pays } = await supabase.from('b2b_payments').select('invoice_id, amount').in('invoice_id', ids)
      const payMap = new Map<number, number>()
      for (const p of (pays || [])) payMap.set(p.invoice_id, (payMap.get(p.invoice_id) || 0) + Number(p.amount))
      for (const inv of invs) inv.paid_amount = payMap.get(inv.id) || 0
    }
    setCustInvoices(invs)
  }

  const filtered = search ? invoices.filter(i => i.customer_name?.includes(search) || i.invoice_number?.includes(search)) : invoices
  const totalBilled = filtered.reduce((s, i) => s + Number(i.total_with_vat), 0)
  const totalPaid = filtered.reduce((s, i) => s + (i.paid_amount || 0), 0)
  const totalOpen = totalBilled - totalPaid

  // Customer detail view
  if (viewCustomer) {
    const custTotalBilled = custInvoices.reduce((s, i) => s + Number(i.total_with_vat), 0)
    const custTotalPaid = custInvoices.reduce((s, i) => s + (i.paid_amount || 0), 0)
    return (
      <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
        <PageHeader title={viewCustomer.name} subtitle={`לקוח הקפה · ${branchName}`} onBack={() => setViewCustomer(null)} />
        <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 32px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>סה"כ חויב</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#6366f1' }}>{fmtM(custTotalBilled)}</div>
            </div>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>שולם</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>{fmtM(custTotalPaid)}</div>
            </div>
            <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '12px 18px', flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>יתרה</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: custTotalBilled - custTotalPaid > 0 ? '#ef4444' : '#10b981' }}>{fmtM(custTotalBilled - custTotalPaid)}</div>
            </div>
          </div>
          <div style={S.card}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={S.th}>תאריך</th><th style={S.th}>חשבונית</th><th style={S.th}>סכום</th><th style={S.th}>שולם</th><th style={S.th}>יתרה</th><th style={S.th}>סטטוס</th>
              </tr></thead>
              <tbody>{custInvoices.map((inv, i) => {
                const st = STATUS_LABELS[inv.status] || STATUS_LABELS.open
                const remaining = Number(inv.total_with_vat) - (inv.paid_amount || 0)
                return (
                  <tr key={inv.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={S.td}>{fmtDate(inv.invoice_date)}</td>
                    <td style={S.td}>{inv.invoice_number || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(inv.total_with_vat)}</td>
                    <td style={{ ...S.td, color: '#10b981' }}>{(inv.paid_amount || 0) > 0 ? fmtM(inv.paid_amount!) : '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: remaining > 0 ? '#ef4444' : '#10b981' }}>{remaining > 0 ? fmtM(remaining) : '—'}</td>
                    <td style={S.td}><span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{st.label}</span></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="לקוחות הקפה" subtitle={branchName} onBack={onBack} />
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 32px' }}>
        <div style={S.card}>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 500 }}>חודש</label>
              <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...S.input, width: 'auto' }} />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4, fontWeight: 500 }}>חיפוש</label>
              <div style={{ position: 'relative' }}>
                <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 10, top: 10 }} />
                <input placeholder="שם לקוח או מספר חשבונית..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...S.input, paddingRight: 32 }} />
              </div>
            </div>
          </div>

          {/* Table */}
          {loading ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>טוען...</div>
          : filtered.length === 0 ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>אין חשבוניות לתקופה זו</div>
          : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>תאריך</th><th style={S.th}>לקוח</th><th style={S.th}>חשבונית</th><th style={S.th}>סה"כ</th><th style={S.th}>סטטוס</th>
                </tr></thead>
                <tbody>{filtered.map((inv, i) => {
                  const st = STATUS_LABELS[inv.status] || STATUS_LABELS.open
                  return (
                    <tr key={inv.id} style={{ background: inv.status === 'overdue' ? '#fef2f2' : i % 2 === 0 ? 'white' : '#fafbfc', cursor: 'pointer' }}
                      onClick={() => openCustomer(inv.customer_id, inv.customer_name || '?')}>
                      <td style={S.td}>{fmtDate(inv.invoice_date)}</td>
                      <td style={{ ...S.td, fontWeight: 500, color: '#6366f1' }}>{inv.customer_name}</td>
                      <td style={S.td}>{inv.invoice_number || '—'}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(inv.total_with_vat)}</td>
                      <td style={S.td}><span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{st.label}</span></td>
                    </tr>
                  )
                })}</tbody>
              </table>

              {/* Summary */}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 8px', borderTop: '2px solid #e2e8f0', marginTop: 4, flexWrap: 'wrap', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#64748b' }}>חויב: <strong style={{ color: '#0f172a' }}>{fmtM(totalBilled)}</strong></span>
                <span style={{ fontSize: 13, color: '#64748b' }}>שולם: <strong style={{ color: '#10b981' }}>{fmtM(totalPaid)}</strong></span>
                <span style={{ fontSize: 13, color: '#64748b' }}>יתרה: <strong style={{ color: totalOpen > 0 ? '#ef4444' : '#10b981' }}>{fmtM(totalOpen)}</strong></span>
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
