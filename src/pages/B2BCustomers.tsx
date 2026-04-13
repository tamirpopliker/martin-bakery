import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Plus, Pencil, Trash2, Check, X, Upload, Search, ChevronLeft, Users, Receipt, BarChart3, AlertTriangle, CheckCircle, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }
interface Customer { id: number; name: string; company_number: string | null; phone: string | null; address: string | null; branch_id: number | null; credit_limit: number; payment_terms: string | null; notes: string | null; open_balance?: number }
interface Invoice { id: number; customer_id: number; invoice_number: string | null; invoice_date: string; due_date: string | null; total_before_vat: number; total_with_vat: number; status: string; branch_id: number | null; uploaded_by: string | null; customer_name?: string; paid_amount?: number }

const PAYMENT_TERMS_OPTIONS = ['מיידי', 'שוטף', 'שוטף + 30', 'שוטף + 60', 'שוטף + 90']
const PAYMENT_METHODS = ['מזומן', 'העברה בנקאית', 'צ\'ק', 'אשראי']

function calcDueDate(invoiceDate: string, terms: string | null): string {
  const d = new Date(invoiceDate + 'T12:00:00')
  if (!terms || terms === 'מיידי') return invoiceDate
  const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  if (terms === 'שוטף') return endOfMonth.toISOString().split('T')[0]
  const match = terms.match(/שוטף\s*\+\s*(\d+)/)
  if (match) { endOfMonth.setDate(endOfMonth.getDate() + parseInt(match[1])); return endOfMonth.toISOString().split('T')[0] }
  d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0]
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: 'פתוח', color: '#a16207', bg: '#fefce8' },
  partial: { label: 'חלקי', color: '#9333ea', bg: '#faf5ff' },
  paid: { label: 'שולם', color: '#166534', bg: '#f0fdf4' },
  overdue: { label: 'באיחור', color: '#dc2626', bg: '#fef2f2' },
}

const S = {
  container: { padding: '24px 32px', maxWidth: 1100, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  input: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  label: { fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 } as React.CSSProperties,
  tab: (a: boolean) => ({ padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', borderBottom: a ? '2px solid #0f172a' : '2px solid transparent', background: 'none', color: a ? '#0f172a' : '#94a3b8' } as React.CSSProperties),
  kpi: (bg: string, color: string) => ({ background: bg, borderRadius: 10, padding: 16, textAlign: 'center' as const, flex: 1, minWidth: 130 }),
}
const fmtM = (n: number) => '₪' + Math.round(n).toLocaleString()
const fmtDate = (d: string) => { if (!d) return '—'; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function B2BCustomers({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const [tab, setTab] = useState<'invoices' | 'reports' | 'customers'>('invoices')
  const [newCustConfirm, setNewCustConfirm] = useState<{ idx: number; name: string } | null>(null)

  // ═══ CUSTOMERS ═══
  const [customers, setCustomers] = useState<Customer[]>([])
  const [custLoading, setCustLoading] = useState(false)
  const [showAddCust, setShowAddCust] = useState(false)
  const [editCustId, setEditCustId] = useState<number | null>(null)
  const [custForm, setCustForm] = useState({ name: '', company_number: '', phone: '', address: '', branch_id: 0, credit_limit: '', payment_terms: 'שוטף + 30', notes: '' })
  const [viewCust, setViewCust] = useState<Customer | null>(null)
  const [custInvoices, setCustInvoices] = useState<Invoice[]>([])
  const [custPayments, setCustPayments] = useState<any[]>([])

  // ═══ INVOICES ═══
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [invLoading, setInvLoading] = useState(false)
  const [invMonth, setInvMonth] = useState(getCurrentMonth())
  const [invStatus, setInvStatus] = useState<string>('all')
  const [invSearch, setInvSearch] = useState('')
  const [showAddInv, setShowAddInv] = useState(false)
  const [invForm, setInvForm] = useState({ customer_id: 0, invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', total_before_vat: '', total_with_vat: '', branch_id: 0 })
  const [editInvId, setEditInvId] = useState<number | null>(null)
  const [deleteInv, setDeleteInv] = useState<Invoice | null>(null)
  const [paymentInv, setPaymentInv] = useState<Invoice | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'העברה בנקאית', receipt_number: '', notes: '' })
  const [pdfParsing, setPdfParsing] = useState(false)
  const [parsedPdfs, setParsedPdfs] = useState<any[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // ═══ REPORTS ═══
  const [reportData, setReportData] = useState<any>({ totalOpen: 0, overdueCount: 0, overdueAmount: 0, avgDays: 0, monthlyBilled: 0, monthlyCollected: 0, collectionPct: 0, byCustomer: [], overdue: [], byBranch: [], chartData: [] })

  const branchName = (id: number | null) => { if (!id) return 'מפעל'; return branches.find(b => b.id === id)?.name || `סניף ${id}` }

  // ═══ LOAD CUSTOMERS ═══
  const loadCustomers = useCallback(async () => {
    setCustLoading(true)
    const { data: custs } = await supabase.from('b2b_customers').select('*').order('name')
    if (custs) {
      const { data: openInv } = await supabase.from('b2b_invoices').select('id, customer_id, total_with_vat, status').in('status', ['open', 'partial', 'overdue'])
      const { data: payments } = await supabase.from('b2b_payments').select('invoice_id, amount')
      const invPayMap = new Map<number, number>()
      for (const p of (payments || [])) invPayMap.set(p.invoice_id, (invPayMap.get(p.invoice_id) || 0) + Number(p.amount))
      const custBalances = new Map<number, number>()
      for (const inv of (openInv || [])) {
        const paid = invPayMap.get(inv.id) || 0
        const remaining = Number(inv.total_with_vat) - paid
        if (remaining > 0) custBalances.set(inv.customer_id, (custBalances.get(inv.customer_id) || 0) + remaining)
      }
      setCustomers(custs.map(c => ({ ...c, open_balance: custBalances.get(c.id) || 0 })))
    }
    setCustLoading(false)
  }, [])

  useEffect(() => { loadCustomers() }, [loadCustomers])

  async function saveCust() {
    const payload = { name: custForm.name, company_number: custForm.company_number || null, phone: custForm.phone || null, address: custForm.address || null, branch_id: custForm.branch_id || null, credit_limit: parseFloat(custForm.credit_limit) || 0, payment_terms: custForm.payment_terms || null, notes: custForm.notes || null }
    if (editCustId) { await supabase.from('b2b_customers').update(payload).eq('id', editCustId); setEditCustId(null) }
    else { await supabase.from('b2b_customers').insert(payload) }
    setCustForm({ name: '', company_number: '', phone: '', address: '', branch_id: 0, credit_limit: '', payment_terms: 'שוטף + 30', notes: '' }); setShowAddCust(false); loadCustomers()
  }

  async function deleteCust(id: number) { if (!confirm('למחוק לקוח זה?')) return; await supabase.from('b2b_customers').delete().eq('id', id); loadCustomers() }

  async function openCustDetail(c: Customer) {
    setViewCust(c)
    const { data: inv } = await supabase.from('b2b_invoices').select('*').eq('customer_id', c.id).order('invoice_date', { ascending: false })
    setCustInvoices(inv || [])
    // Get payments for this customer's invoices
    const invIds = (inv || []).map((i: any) => i.id)
    if (invIds.length > 0) {
      const { data: pay } = await supabase.from('b2b_payments').select('*').in('invoice_id', invIds).order('payment_date', { ascending: false })
      setCustPayments(pay || [])
    } else { setCustPayments([]) }
    // Calculate paid amounts for display
    if (inv) {
      const { data: allPay } = await supabase.from('b2b_payments').select('invoice_id, amount').in('invoice_id', invIds)
      const payMap = new Map<number, number>()
      for (const p of (allPay || [])) payMap.set(p.invoice_id, (payMap.get(p.invoice_id) || 0) + Number(p.amount))
      setCustInvoices(inv.map((i: any) => ({ ...i, paid_amount: payMap.get(i.id) || 0 })))
    }
  }

  // ═══ LOAD INVOICES ═══
  const loadInvoices = useCallback(async () => {
    setInvLoading(true)
    const [y, m] = invMonth.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const last = new Date(y, m, 0).getDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    let q = supabase.from('b2b_invoices').select('*, b2b_customers(name)').gte('invoice_date', from).lte('invoice_date', to).order('invoice_date', { ascending: false })
    if (invStatus !== 'all') q = q.eq('status', invStatus)
    const { data } = await q
    const invs = (data || []).map((inv: any) => ({ ...inv, customer_name: inv.b2b_customers?.name || '?' }))
    const ids = invs.map((i: any) => i.id)
    if (ids.length > 0) {
      const { data: pays } = await supabase.from('b2b_payments').select('invoice_id, amount, receipt_number').in('invoice_id', ids)
      const payMap = new Map<number, number>()
      const receiptMap = new Map<number, string>()
      for (const p of (pays || [])) {
        payMap.set(p.invoice_id, (payMap.get(p.invoice_id) || 0) + Number(p.amount))
        if (p.receipt_number) receiptMap.set(p.invoice_id, p.receipt_number)
      }
      for (const inv of invs) { inv.paid_amount = payMap.get(inv.id) || 0; (inv as any).receipt_number = receiptMap.get(inv.id) || null }
    }
    setInvoices(invs); setInvLoading(false)
  }, [invMonth, invStatus])

  useEffect(() => { if (tab === 'invoices') loadInvoices() }, [tab, loadInvoices])

  async function saveInvoice() {
    const cust = customers.find(c => c.id === invForm.customer_id)
    const dueDate = invForm.due_date || calcDueDate(invForm.invoice_date, cust?.payment_terms || null)
    const payload = { customer_id: invForm.customer_id, invoice_number: invForm.invoice_number || null, invoice_date: invForm.invoice_date, due_date: dueDate, total_before_vat: parseFloat(invForm.total_before_vat) || 0, total_with_vat: parseFloat(invForm.total_with_vat) || 0, branch_id: invForm.branch_id || null, status: 'open', uploaded_by: appUser?.name || null }
    if (editInvId) { await supabase.from('b2b_invoices').update(payload).eq('id', editInvId); setEditInvId(null) }
    else {
      if (invForm.invoice_number) {
        const { data: existing } = await supabase.from('b2b_invoices').select('id').eq('invoice_number', invForm.invoice_number).maybeSingle()
        if (existing) { if (!confirm(`חשבונית ${invForm.invoice_number} כבר קיימת. לעדכן?`)) return; await supabase.from('b2b_invoices').update(payload).eq('id', existing.id); setShowAddInv(false); loadInvoices(); return }
      }
      await supabase.from('b2b_invoices').insert(payload)
    }
    setShowAddInv(false); setInvForm({ customer_id: 0, invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', total_before_vat: '', total_with_vat: '', branch_id: 0 }); loadInvoices()
  }

  async function deleteInvoice(inv: Invoice) { await supabase.from('b2b_invoices').delete().eq('id', inv.id); setDeleteInv(null); loadInvoices() }

  async function savePayment() {
    if (!paymentInv || !payForm.amount) return
    const amount = parseFloat(payForm.amount)
    await supabase.from('b2b_payments').insert({ invoice_id: paymentInv.id, payment_date: payForm.payment_date, amount, payment_method: payForm.payment_method, receipt_number: payForm.receipt_number || null, notes: payForm.notes || null })
    const totalPaid = (paymentInv.paid_amount || 0) + amount
    const newStatus = totalPaid >= paymentInv.total_with_vat ? 'paid' : 'partial'
    await supabase.from('b2b_invoices').update({ status: newStatus }).eq('id', paymentInv.id)
    setPaymentInv(null); setPayForm({ amount: '', payment_date: new Date().toISOString().split('T')[0], payment_method: 'העברה בנקאית', receipt_number: '', notes: '' }); loadInvoices(); loadCustomers()
  }

  // PDF upload
  async function handlePDFs(files: FileList) {
    setPdfParsing(true); const results: any[] = []
    for (const file of Array.from(files)) {
      try {
        const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.onerror = rej; r.readAsDataURL(file) })
        const { data } = await supabase.functions.invoke('extract-invoice', { body: { pdf_base64: base64 } })
        if (data?.success) {
          const inv = data.data
          const matchCust = customers.find(c => c.name.includes(inv.customer_name) || inv.customer_name?.includes(c.name))
          const dateStr = inv.invoice_date ? (() => { const p = inv.invoice_date.split('/'); return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : inv.invoice_date })() : new Date().toISOString().split('T')[0]
          results.push({ ...inv, fileName: file.name, customer_id: matchCust?.id || 0, branch_id: matchCust?.branch_id || 0, invoice_date_db: dateStr, status: 'parsed', selected: true })
        } else { results.push({ fileName: file.name, status: 'error', error: data?.error || 'שגיאה' }) }
      } catch { results.push({ fileName: file.name, status: 'error', error: 'שגיאה בקריאת הקובץ' }) }
    }
    setParsedPdfs(results); setPdfParsing(false)
  }

  async function saveParsedInvoice(idx: number) {
    const inv = parsedPdfs[idx]
    let customerId = inv.customer_id
    if (!customerId) { if (inv.customer_name) { setNewCustConfirm({ idx, name: inv.customer_name }); return } else { alert('יש לבחור לקוח'); return } }
    let dateDb = inv.invoice_date_db
    if (inv.invoice_date && inv.invoice_date.includes('/')) { const p = inv.invoice_date.split('/'); if (p.length === 3) dateDb = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` }
    const cust = customers.find(c => c.id === customerId)
    const dueDateStr = calcDueDate(dateDb, cust?.payment_terms || null)
    if (inv.invoice_number) {
      const { data: existing } = await supabase.from('b2b_invoices').select('id').eq('invoice_number', inv.invoice_number).maybeSingle()
      if (existing) { if (!confirm(`חשבונית ${inv.invoice_number} כבר קיימת. לעדכן?`)) return; await supabase.from('b2b_invoices').update({ customer_id: customerId, invoice_date: dateDb, due_date: dueDateStr, total_before_vat: Number(inv.total_before_vat) || 0, total_with_vat: Number(inv.total_before_vat) * 1.17 || 0 }).eq('id', existing.id); setParsedPdfs(prev => prev.map((p, i) => i === idx ? { ...p, status: 'saved' } : p)); loadInvoices(); return }
    }
    const branchId = inv.branch_id || null; const amount = Number(inv.total_before_vat) || 0
    await supabase.from('b2b_invoices').insert({ customer_id: customerId, invoice_number: inv.invoice_number || null, invoice_date: dateDb, due_date: dueDateStr, total_before_vat: amount, total_with_vat: amount * 1.17, branch_id: branchId, status: 'open', uploaded_by: appUser?.name })
    if (branchId) { await supabase.from('branch_revenue').insert({ branch_id: branchId, date: dateDb, source: 'credit_b2b', amount, doc_number: inv.invoice_number || null }) }
    else { await supabase.from('external_sales').insert({ customer_name: inv.customer_name || '', invoice_number: inv.invoice_number || null, invoice_date: dateDb, total_before_vat: amount, uploaded_by: appUser?.name }) }
    setParsedPdfs(prev => prev.map((p, i) => i === idx ? { ...p, status: 'saved' } : p)); loadInvoices()
  }

  async function confirmCreateCustomerAndSave(idx: number, customerName: string) {
    const { data: newCust } = await supabase.from('b2b_customers').insert({ name: customerName }).select().single()
    if (!newCust) { alert('שגיאה ביצירת לקוח'); return }
    setParsedPdfs(prev => prev.map((p, i) => i === idx ? { ...p, customer_id: newCust.id } : p))
    setNewCustConfirm(null); loadCustomers()
    const inv = parsedPdfs[idx]; let dateDb = inv.invoice_date_db
    if (inv.invoice_date && inv.invoice_date.includes('/')) { const p = inv.invoice_date.split('/'); if (p.length === 3) dateDb = `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` }
    const dueDateStr = calcDueDate(dateDb, 'שוטף + 30'); const branchId = inv.branch_id || null; const amount = Number(inv.total_before_vat) || 0
    await supabase.from('b2b_invoices').insert({ customer_id: newCust.id, invoice_number: inv.invoice_number || null, invoice_date: dateDb, due_date: dueDateStr, total_before_vat: amount, total_with_vat: amount * 1.17, branch_id: branchId, status: 'open', uploaded_by: appUser?.name })
    if (branchId) { await supabase.from('branch_revenue').insert({ branch_id: branchId, date: dateDb, source: 'credit_b2b', amount, doc_number: inv.invoice_number || null }) }
    else { await supabase.from('external_sales').insert({ customer_name: customerName, invoice_number: inv.invoice_number || null, invoice_date: dateDb, total_before_vat: amount, uploaded_by: appUser?.name }) }
    setParsedPdfs(prev => prev.map((p, i) => i === idx ? { ...p, status: 'saved' } : p)); loadInvoices()
  }

  // ═══ LOAD REPORTS ═══
  const loadReports = useCallback(async () => {
    const { data: allInv } = await supabase.from('b2b_invoices').select('*, b2b_customers(name, payment_terms, branch_id)').order('invoice_date', { ascending: false })
    const { data: allPay } = await supabase.from('b2b_payments').select('*').order('payment_date', { ascending: false })
    const payMap = new Map<number, number>()
    for (const p of (allPay || [])) payMap.set(p.invoice_id, (payMap.get(p.invoice_id) || 0) + Number(p.amount))

    const today = new Date().toISOString().split('T')[0]
    const thisMonth = getCurrentMonth()
    let totalOpen = 0; let overdueCount = 0; let overdueAmount = 0; let totalDays = 0; let dayCount = 0
    let monthlyBilled = 0; let monthlyCollected = 0
    const custMap = new Map<number, { name: string; count: number; total: number; oldest: string; branch_id: number | null; payment_terms: string | null }>()
    const overdueList: any[] = []; const branchMap = new Map<number | null, number>()

    for (const inv of (allInv || [])) {
      const paid = payMap.get(inv.id) || 0; const remaining = Number(inv.total_with_vat) - paid
      // Monthly billed
      if (inv.invoice_date.startsWith(thisMonth)) monthlyBilled += Number(inv.total_with_vat)
      // Open balance
      if (['open', 'partial', 'overdue'].includes(inv.status) && remaining > 0) {
        totalOpen += remaining
        const daysOpen = Math.floor((Date.now() - new Date(inv.invoice_date).getTime()) / 86400000)
        totalDays += daysOpen; dayCount++
        const cm = custMap.get(inv.customer_id) || { name: inv.b2b_customers?.name || '?', count: 0, total: 0, oldest: inv.invoice_date, branch_id: inv.b2b_customers?.branch_id, payment_terms: inv.b2b_customers?.payment_terms }
        cm.count++; cm.total += remaining; if (inv.invoice_date < cm.oldest) cm.oldest = inv.invoice_date
        custMap.set(inv.customer_id, cm)
        branchMap.set(inv.branch_id, (branchMap.get(inv.branch_id) || 0) + remaining)
        if (inv.due_date && inv.due_date < today) {
          overdueCount++; overdueAmount += remaining
          overdueList.push({ customer: inv.b2b_customers?.name, invoice_number: inv.invoice_number, amount: remaining, due_date: inv.due_date, daysLate: Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000) })
        }
      }
    }

    // Monthly collected
    for (const p of (allPay || [])) { if (p.payment_date.startsWith(thisMonth)) monthlyCollected += Number(p.amount) }
    const collectionPct = monthlyBilled > 0 ? (monthlyCollected / monthlyBilled * 100) : 0

    // 6-month chart
    const chartData: { month: string; billed: number; collected: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i)
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const mLabel = `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`
      const billed = (allInv || []).filter((inv: any) => inv.invoice_date.startsWith(mk)).reduce((s: number, inv: any) => s + Number(inv.total_with_vat), 0)
      const collected = (allPay || []).filter((p: any) => p.payment_date.startsWith(mk)).reduce((s: number, p: any) => s + Number(p.amount), 0)
      chartData.push({ month: mLabel, billed: Math.round(billed), collected: Math.round(collected) })
    }

    setReportData({
      totalOpen, overdueCount, overdueAmount, avgDays: dayCount > 0 ? Math.round(totalDays / dayCount) : 0,
      monthlyBilled, monthlyCollected, collectionPct,
      byCustomer: [...custMap.values()].sort((a, b) => b.total - a.total),
      overdue: overdueList.sort((a, b) => b.daysLate - a.daysLate),
      byBranch: [...branchMap.entries()].map(([bid, total]) => ({ branch: branchName(bid), total })).sort((a, b) => b.total - a.total),
      chartData,
    })
  }, [branches])

  useEffect(() => { if (tab === 'reports') loadReports() }, [tab, loadReports])

  // Excel export
  function exportExcel() {
    const header = 'תאריך,חשבונית,לקוח,סניף,לפני מע"מ,כולל מע"מ,פירעון,סטטוס,שולם,סכום ששולם,מספר קבלה,יתרה פתוחה\n'
    const rows = invoices.map(inv => {
      const paid = inv.paid_amount || 0
      const remaining = inv.total_with_vat - paid
      return `${inv.invoice_date},${inv.invoice_number || ''},${inv.customer_name || ''},${branchName(inv.branch_id)},${inv.total_before_vat},${inv.total_with_vat},${inv.due_date || ''},${STATUS_LABELS[inv.status]?.label || inv.status},${inv.status === 'paid' ? 'כן' : 'לא'},${paid},${(inv as any).receipt_number || ''},${remaining > 0 ? remaining : 0}`
    }).join('\n')
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `b2b_invoices_${invMonth}.csv`; a.click()
  }

  const filteredInv = invSearch ? invoices.filter(i => i.customer_name?.includes(invSearch) || i.invoice_number?.includes(invSearch)) : invoices

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="לקוחות הקפה (B2B)" subtitle="חשבוניות · תשלומים · מעקב חובות" onBack={onBack} />
      <div style={S.container}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(tab === 'invoices')} onClick={() => setTab('invoices')}><Receipt size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> חשבוניות</button>
          <button style={S.tab(tab === 'reports')} onClick={() => setTab('reports')}><BarChart3 size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> דוחות וחובות</button>
          <button style={S.tab(tab === 'customers')} onClick={() => { setTab('customers'); setViewCust(null) }}><Users size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> לקוחות</button>
        </div>

        {/* ═══ INVOICES TAB ═══ */}
        {tab === 'invoices' && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div><label style={S.label}>חודש</label><input type="month" value={invMonth} onChange={e => setInvMonth(e.target.value)} style={{ ...S.input, width: 'auto' }} /></div>
              <div><label style={S.label}>סטטוס</label><select value={invStatus} onChange={e => setInvStatus(e.target.value)} style={{ ...S.input, width: 'auto' }}><option value="all">הכל</option><option value="open">פתוח</option><option value="partial">חלקי</option><option value="paid">שולם</option><option value="overdue">באיחור</option></select></div>
              <div style={{ flex: 1, minWidth: 180 }}><label style={S.label}>חיפוש</label><input placeholder="לקוח או חשבונית..." value={invSearch} onChange={e => setInvSearch(e.target.value)} style={S.input} /></div>
              <button onClick={() => { setShowAddInv(!showAddInv); setParsedPdfs([]) }} style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}><Plus size={14} /> הוסף</button>
              <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files?.length) handlePDFs(e.target.files) }} />
              <button onClick={() => fileRef.current?.click()} style={{ ...S.btn, background: 'white', color: '#6366f1', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}><Upload size={14} /> PDF</button>
              <button onClick={exportExcel} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 12px' }} title="ייצוא Excel"><Download size={14} /></button>
            </div>

            {showAddInv && parsedPdfs.length === 0 && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  <div><label style={S.label}>לקוח</label><select value={invForm.customer_id} onChange={e => setInvForm(p => ({ ...p, customer_id: Number(e.target.value) }))} style={S.input}><option value={0}>בחר...</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                  <div><label style={S.label}>מספר חשבונית</label><input value={invForm.invoice_number} onChange={e => setInvForm(p => ({ ...p, invoice_number: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>תאריך</label><input type="date" value={invForm.invoice_date} onChange={e => setInvForm(p => ({ ...p, invoice_date: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>תאריך פירעון</label><input type="date" value={invForm.due_date} onChange={e => setInvForm(p => ({ ...p, due_date: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>סה"כ לפני מע"מ</label><input type="number" value={invForm.total_before_vat} onChange={e => setInvForm(p => ({ ...p, total_before_vat: e.target.value, total_with_vat: String(Number(e.target.value) * 1.17) }))} style={S.input} /></div>
                  <div><label style={S.label}>סניף</label><select value={invForm.branch_id} onChange={e => setInvForm(p => ({ ...p, branch_id: Number(e.target.value) }))} style={S.input}><option value={0}>מפעל</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={saveInvoice} disabled={!invForm.customer_id} style={{ ...S.btn, background: invForm.customer_id ? '#0f172a' : '#e2e8f0', color: invForm.customer_id ? 'white' : '#94a3b8', padding: '8px 16px', fontSize: 13 }}>שמור</button>
                  <button onClick={() => setShowAddInv(false)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', fontSize: 13 }}>ביטול</button>
                </div>
              </div>
            )}

            {pdfParsing && <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>מעבד חשבוניות... ⏳</div>}
            {parsedPdfs.length > 0 && !pdfParsing && (() => {
              const activePdfs = parsedPdfs.filter(p => p.status === 'parsed')
              const selectedCount = activePdfs.filter(p => p.selected).length
              const allSelected = activePdfs.length > 0 && selectedCount === activePdfs.length
              const someSelected = selectedCount > 0 && selectedCount < activePdfs.length
              return (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #f1f5f9' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>תצוגה מקדימה — {parsedPdfs.length} חשבוניות</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...S.th, width: 32 }}>
                      <input type="checkbox" checked={allSelected} ref={el => { if (el) el.indeterminate = someSelected }}
                        onChange={() => setParsedPdfs(prev => prev.map(p => p.status === 'parsed' ? { ...p, selected: !allSelected } : p))}
                        style={{ cursor: 'pointer', width: 16, height: 16 }} />
                    </th>
                    <th style={S.th}>קובץ</th><th style={S.th}>שם לקוח</th><th style={S.th}>שיוך</th><th style={S.th}>חשבונית</th><th style={S.th}>תאריך</th><th style={S.th}>סכום</th><th style={S.th}>סניף</th><th style={{ ...S.th, width: 36 }}></th>
                  </tr></thead>
                  <tbody>{parsedPdfs.map((p, i) => (
                    <tr key={i} style={{ background: p.status === 'error' ? '#fef2f2' : p.status === 'saved' ? '#f0fdf4' : !p.selected ? '#f8fafc' : i % 2 === 0 ? 'white' : '#fafbfc', opacity: p.status === 'parsed' && !p.selected ? 0.5 : 1, textDecoration: p.status === 'parsed' && !p.selected ? 'line-through' : 'none' }}>
                      <td style={S.td}>
                        {p.status === 'parsed' && <input type="checkbox" checked={p.selected ?? true} onChange={() => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, selected: !pp.selected } : pp))} style={{ cursor: 'pointer', width: 16, height: 16 }} />}
                      </td>
                      <td style={{ ...S.td, fontSize: 11, color: '#94a3b8', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.fileName}</td>
                      {p.status === 'error' ? <td colSpan={6} style={{ ...S.td, color: '#dc2626', fontSize: 12 }}>❌ {p.error}</td>
                      : p.status === 'saved' ? <td colSpan={6} style={{ ...S.td, color: '#16a34a', fontWeight: 600 }}>✅ נשמר</td>
                      : (<>
                        <td style={S.td}><input type="text" value={p.customer_name || ''} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, customer_name: e.target.value } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12, fontWeight: 600 }} /></td>
                        <td style={S.td}><select value={p.customer_id} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, customer_id: Number(e.target.value) } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12 }}><option value={0}>לקוח חדש</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                        <td style={S.td}><input type="text" value={p.invoice_number || ''} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, invoice_number: e.target.value } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12 }} /></td>
                        <td style={S.td}><input type="text" value={p.invoice_date || ''} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, invoice_date: e.target.value } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12, width: 90 }} /></td>
                        <td style={{ ...S.td, fontWeight: 600 }}><input type="number" step="0.01" value={p.total_before_vat || ''} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, total_before_vat: Number(e.target.value) } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12, width: 80 }} /></td>
                        <td style={S.td}><select value={p.branch_id ?? 0} onChange={e => setParsedPdfs(prev => prev.map((pp, j) => j === i ? { ...pp, branch_id: Number(e.target.value) } : pp))} style={{ ...S.input, padding: '4px 8px', fontSize: 12 }}><option value={0}>מפעל</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>
                      </>)}
                      <td style={S.td}>{p.status === 'parsed' && <button onClick={() => setParsedPdfs(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}><Trash2 size={13} color="#94a3b8" /></button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  {selectedCount > 0 ? (
                    <button onClick={async () => { for (let i = 0; i < parsedPdfs.length; i++) { if (parsedPdfs[i].selected && parsedPdfs[i].status === 'parsed') await saveParsedInvoice(i) } }}
                      style={{ ...S.btn, background: '#6366f1', color: 'white', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle size={14} /> שמור {selectedCount} חשבוניות נבחרות
                    </button>
                  ) : (
                    <button disabled style={{ ...S.btn, background: '#e2e8f0', color: '#94a3b8', cursor: 'not-allowed' }}>בחר לפחות חשבונית אחת</button>
                  )}
                  <button onClick={() => setParsedPdfs([])} style={{ ...S.btn, background: '#f1f5f9', color: '#64748b', padding: '6px 14px', fontSize: 12 }}>סגור</button>
                </div>
              </div>
              )
            })()}

            {invLoading ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>טוען...</div> : filteredInv.length === 0 ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>אין חשבוניות</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={S.th}>תאריך</th><th style={S.th}>חשבונית</th><th style={S.th}>לקוח</th><th style={S.th}>סכום</th><th style={S.th}>קבלה</th><th style={S.th}>פירעון</th><th style={S.th}>סטטוס</th><th style={{ ...S.th, width: 130 }}></th></tr></thead>
                <tbody>{filteredInv.map((inv, i) => { const st = STATUS_LABELS[inv.status] || STATUS_LABELS.open; const remaining = inv.total_with_vat - (inv.paid_amount || 0); return (
                  <tr key={inv.id} style={{ background: inv.status === 'overdue' ? '#fef2f2' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={S.td}>{fmtDate(inv.invoice_date)}</td>
                    <td style={S.td}>{inv.invoice_number || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 500, cursor: 'pointer', color: '#6366f1' }} onClick={() => { const c = customers.find(cc => cc.id === inv.customer_id); if (c) { setTab('customers'); openCustDetail(c) } }}>{inv.customer_name}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(inv.total_with_vat)}{(inv.paid_amount || 0) > 0 ? <div style={{ fontSize: 11, color: '#16a34a' }}>שולם: {fmtM(inv.paid_amount!)}</div> : null}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{(inv as any).receipt_number || '—'}</td>
                    <td style={S.td}>{fmtDate(inv.due_date || '')}</td>
                    <td style={S.td}><span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{st.label}</span></td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {inv.status !== 'paid' && <button onClick={() => { setPaymentInv({ ...inv, paid_amount: inv.paid_amount || 0 }); setPayForm({ amount: String(remaining.toFixed(2)), payment_date: new Date().toISOString().split('T')[0], payment_method: 'העברה בנקאית', receipt_number: '', notes: '' }) }} style={{ ...S.btn, padding: '3px 8px', fontSize: 10, background: '#f0fdf4', color: '#16a34a' }}>💰 תשלום</button>}
                        <button onClick={() => setDeleteInv(inv)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ) })}</tbody>
              </table>
            )}
          </div>
        )}

        {/* ═══ REPORTS TAB ═══ */}
        {tab === 'reports' && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                { label: 'חיובים החודש', value: fmtM(reportData.monthlyBilled), bg: '#eff6ff', color: '#1d4ed8' },
                { label: 'גביה החודש', value: fmtM(reportData.monthlyCollected), bg: '#f0fdf4', color: '#16a34a' },
                { label: 'יתרה פתוחה', value: fmtM(reportData.totalOpen), bg: '#fef2f2', color: '#dc2626' },
                { label: '% גביה', value: `${reportData.collectionPct.toFixed(0)}%`, bg: '#faf5ff', color: '#7c3aed' },
                { label: 'באיחור', value: `${reportData.overdueCount} (${fmtM(reportData.overdueAmount)})`, bg: '#fff7ed', color: '#c2410c' },
                { label: 'ממוצע ימי גביה', value: `${reportData.avgDays} ימים`, bg: '#f0f9ff', color: '#0369a1' },
              ].map((kpi, i) => (
                <div key={i} style={S.kpi(kpi.bg, kpi.color)}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: kpi.color, marginBottom: 4 }}>{kpi.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* 6-month chart */}
            {reportData.chartData.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>מגמת חיובים וגביה — 6 חודשים</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={reportData.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₪${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => fmtM(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="billed" name="חיובים" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="collected" name="גביה" stroke="#16a34a" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Export buttons */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={exportExcel} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} /> ייצוא Excel</button>
            </div>

            {reportData.byCustomer.length > 0 && (<>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>חובות לפי לקוח</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <thead><tr><th style={S.th}>לקוח</th><th style={S.th}>סניף</th><th style={S.th}>תנאי תשלום</th><th style={S.th}>חשבוניות</th><th style={S.th}>סה"כ חוב</th><th style={S.th}>הישנה</th></tr></thead>
                <tbody>{reportData.byCustomer.map((c: any, i: number) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={{ ...S.td, fontWeight: 500 }}>{c.name}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#94a3b8' }}>{branchName(c.branch_id)}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{c.payment_terms || 'שוטף + 30'}</td>
                    <td style={S.td}>{c.count}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: '#dc2626' }}>{fmtM(c.total)}</td>
                    <td style={S.td}>{fmtDate(c.oldest)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}

            {reportData.overdue.length > 0 && (<>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px', color: '#dc2626' }}>⚠️ חשבוניות באיחור</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                <thead><tr><th style={S.th}>לקוח</th><th style={S.th}>חשבונית</th><th style={S.th}>סכום</th><th style={S.th}>פירעון</th><th style={S.th}>ימי איחור</th></tr></thead>
                <tbody>{reportData.overdue.map((o: any, i: number) => (
                  <tr key={i} style={{ background: '#fef2f2' }}>
                    <td style={S.td}>{o.customer}</td><td style={S.td}>{o.invoice_number || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(o.amount)}</td>
                    <td style={S.td}>{fmtDate(o.due_date)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: '#dc2626' }}>{o.daysLate}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}

            {reportData.byBranch.length > 0 && (<>
              <h4 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 8px' }}>סיכום לפי סניף</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={S.th}>סניף</th><th style={S.th}>סה"כ חוב</th></tr></thead>
                <tbody>{reportData.byBranch.map((b: any, i: number) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}><td style={S.td}>{b.branch}</td><td style={{ ...S.td, fontWeight: 600 }}>{fmtM(b.total)}</td></tr>
                ))}</tbody>
              </table>
            </>)}
          </div>
        )}

        {/* ═══ CUSTOMERS TAB ═══ */}
        {tab === 'customers' && !viewCust && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>רשימת לקוחות</h3>
              <button onClick={() => { setShowAddCust(true); setEditCustId(null); setCustForm({ name: '', company_number: '', phone: '', address: '', branch_id: 0, credit_limit: '', payment_terms: 'שוטף + 30', notes: '' }) }} style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}><Plus size={14} /> הוסף לקוח</button>
            </div>
            {showAddCust && (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  <div><label style={S.label}>שם</label><input value={custForm.name} onChange={e => setCustForm(p => ({ ...p, name: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>ח.פ</label><input value={custForm.company_number} onChange={e => setCustForm(p => ({ ...p, company_number: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>טלפון</label><input value={custForm.phone} onChange={e => setCustForm(p => ({ ...p, phone: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>כתובת</label><input value={custForm.address} onChange={e => setCustForm(p => ({ ...p, address: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>סניף</label><select value={custForm.branch_id} onChange={e => setCustForm(p => ({ ...p, branch_id: Number(e.target.value) }))} style={S.input}><option value={0}>מפעל</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
                  <div><label style={S.label}>מסגרת אשראי</label><input type="number" value={custForm.credit_limit} onChange={e => setCustForm(p => ({ ...p, credit_limit: e.target.value }))} style={S.input} /></div>
                  <div><label style={S.label}>תנאי תשלום</label><select value={custForm.payment_terms} onChange={e => setCustForm(p => ({ ...p, payment_terms: e.target.value }))} style={S.input}>{PAYMENT_TERMS_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                  <div><label style={S.label}>הערות</label><input value={custForm.notes} onChange={e => setCustForm(p => ({ ...p, notes: e.target.value }))} style={S.input} /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={saveCust} disabled={!custForm.name} style={{ ...S.btn, background: custForm.name ? '#0f172a' : '#e2e8f0', color: custForm.name ? 'white' : '#94a3b8', padding: '8px 16px', fontSize: 13 }}>שמור</button>
                  <button onClick={() => setShowAddCust(false)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0', padding: '8px 16px', fontSize: 13 }}>ביטול</button>
                </div>
              </div>
            )}
            {custLoading ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>טוען...</div> : customers.length === 0 ? <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8' }}>אין לקוחות</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={S.th}>שם</th><th style={S.th}>ח.פ</th><th style={S.th}>טלפון</th><th style={S.th}>סניף</th><th style={S.th}>תנאי תשלום</th><th style={S.th}>מסגרת</th><th style={S.th}>יתרה</th><th style={{ ...S.th, width: 70 }}></th></tr></thead>
                <tbody>{customers.map((c, i) => (
                  <tr key={c.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc', cursor: 'pointer' }} onClick={() => openCustDetail(c)}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>{c.company_number || '—'}</td>
                    <td style={S.td}>{c.phone || '—'}</td>
                    <td style={S.td}>{branchName(c.branch_id)}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{c.payment_terms || 'שוטף + 30'}</td>
                    <td style={S.td}>{c.credit_limit ? fmtM(c.credit_limit) : '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: (c.open_balance || 0) > 0 ? '#dc2626' : '#16a34a' }}>{(c.open_balance || 0) > 0 ? fmtM(c.open_balance!) : '—'}</td>
                    <td style={S.td} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button onClick={() => { setEditCustId(c.id); setCustForm({ name: c.name, company_number: c.company_number || '', phone: c.phone || '', address: c.address || '', branch_id: c.branch_id || 0, credit_limit: String(c.credit_limit || ''), payment_terms: c.payment_terms || 'שוטף + 30', notes: c.notes || '' }); setShowAddCust(true) }} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }}><Pencil size={12} /></button>
                        <button onClick={() => deleteCust(c.id)} style={{ ...S.btn, padding: '3px 6px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}

        {/* Customer detail */}
        {tab === 'customers' && viewCust && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{viewCust.name}</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  {viewCust.company_number ? `ח.פ ${viewCust.company_number} · ` : ''}{branchName(viewCust.branch_id)}
                  {viewCust.phone ? ` · ${viewCust.phone}` : ''} · {viewCust.payment_terms || 'שוטף + 30'}
                  {viewCust.credit_limit ? ` · מסגרת: ${fmtM(viewCust.credit_limit)}` : ''}
                </p>
              </div>
              <button onClick={() => setViewCust(null)} style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}><ChevronLeft size={14} /> חזרה</button>
            </div>

            {/* Customer KPIs */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={S.kpi('#eff6ff', '#1d4ed8')}>
                <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600 }}>סה"כ חויב</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#1d4ed8' }}>{fmtM(custInvoices.reduce((s, inv) => s + Number(inv.total_with_vat), 0))}</div>
              </div>
              <div style={S.kpi('#f0fdf4', '#16a34a')}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>סה"כ שולם</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#16a34a' }}>{fmtM(custPayments.reduce((s, p) => s + Number(p.amount), 0))}</div>
              </div>
              <div style={S.kpi('#fef2f2', '#dc2626')}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>יתרה פתוחה</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#dc2626' }}>{fmtM(viewCust.open_balance || 0)}</div>
              </div>
            </div>

            <h4 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>חשבוניות ({custInvoices.length})</h4>
            {custInvoices.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>אין חשבוניות</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                <thead><tr><th style={S.th}>תאריך</th><th style={S.th}>חשבונית</th><th style={S.th}>סכום</th><th style={S.th}>שולם</th><th style={S.th}>יתרה</th><th style={S.th}>פירעון</th><th style={S.th}>סטטוס</th><th style={{ ...S.th, width: 80 }}></th></tr></thead>
                <tbody>{custInvoices.map((inv, i) => { const st = STATUS_LABELS[inv.status] || STATUS_LABELS.open; const remaining = Number(inv.total_with_vat) - (inv.paid_amount || 0); return (
                  <tr key={inv.id} style={{ background: inv.status === 'overdue' ? '#fef2f2' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={S.td}>{fmtDate(inv.invoice_date)}</td><td style={S.td}>{inv.invoice_number || '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmtM(inv.total_with_vat)}</td>
                    <td style={{ ...S.td, color: '#16a34a' }}>{(inv.paid_amount || 0) > 0 ? fmtM(inv.paid_amount!) : '—'}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: remaining > 0 ? '#dc2626' : '#16a34a' }}>{remaining > 0 ? fmtM(remaining) : '—'}</td>
                    <td style={S.td}>{fmtDate(inv.due_date || '')}</td>
                    <td style={S.td}><span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{st.label}</span></td>
                    <td style={S.td}>{inv.status !== 'paid' && <button onClick={() => { setPaymentInv({ ...inv, paid_amount: inv.paid_amount || 0 }); setPayForm({ amount: String(remaining.toFixed(2)), payment_date: new Date().toISOString().split('T')[0], payment_method: 'העברה בנקאית', receipt_number: '', notes: '' }) }} style={{ ...S.btn, padding: '3px 8px', fontSize: 10, background: '#f0fdf4', color: '#16a34a' }}>💰</button>}</td>
                  </tr>
                ) })}</tbody>
              </table>
            )}

            {custPayments.length > 0 && (<>
              <h4 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>תשלומים ({custPayments.length})</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={S.th}>תאריך</th><th style={S.th}>סכום</th><th style={S.th}>אמצעי</th><th style={S.th}>הערה</th></tr></thead>
                <tbody>{custPayments.map((p: any, i: number) => (
                  <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                    <td style={S.td}>{fmtDate(p.payment_date)}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: '#16a34a' }}>{fmtM(p.amount)}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{p.payment_method || '—'}</td>
                    <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{p.notes || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </>)}
          </div>
        )}
      </div>

      {/* Payment modal */}
      {paymentInv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPaymentInv(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 400, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px' }}>💰 רישום תשלום</h3>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px' }}>חשבונית {paymentInv.invoice_number || '—'} · יתרה: {fmtM(paymentInv.total_with_vat - (paymentInv.paid_amount || 0))}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div><label style={S.label}>סכום</label><input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))} style={S.input} /></div>
              <div><label style={S.label}>תאריך</label><input type="date" value={payForm.payment_date} onChange={e => setPayForm(p => ({ ...p, payment_date: e.target.value }))} style={S.input} /></div>
              <div><label style={S.label}>אמצעי תשלום</label><select value={payForm.payment_method} onChange={e => setPayForm(p => ({ ...p, payment_method: e.target.value }))} style={S.input}>{PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><label style={S.label}>מספר קבלה</label><input value={payForm.receipt_number} onChange={e => setPayForm(p => ({ ...p, receipt_number: e.target.value }))} placeholder="אופציונלי" style={S.input} /></div>
              <div><label style={S.label}>הערה</label><input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} style={S.input} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={savePayment} style={{ ...S.btn, background: '#0f172a', color: 'white' }}>אשר תשלום</button>
              <button onClick={() => setPaymentInv(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteInv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setDeleteInv(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 380, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>מחיקת חשבונית</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>למחוק חשבונית {deleteInv.invoice_number || ''} של {deleteInv.customer_name}?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => deleteInvoice(deleteInv)} style={{ ...S.btn, background: '#ef4444', color: 'white' }}>מחק</button>
              <button onClick={() => setDeleteInv(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* New customer confirm */}
      {newCustConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setNewCustConfirm(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 400, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>לקוח חדש</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>הלקוח <strong style={{ color: '#0f172a' }}>"{newCustConfirm.name}"</strong> לא קיים במערכת. האם ליצור אותו?</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => confirmCreateCustomerAndSave(newCustConfirm.idx, newCustConfirm.name)} style={{ ...S.btn, background: '#0f172a', color: 'white' }}>צור ושמור</button>
              <button onClick={() => setNewCustConfirm(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
