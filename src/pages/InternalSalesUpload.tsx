import { useState, useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileSpreadsheet, FileText, CheckCircle, AlertTriangle, ChevronLeft, History, Pencil, Trash2, Eye } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAppUser } from '../lib/UserContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import { parseDeliveryNotePDF } from '../lib/parseDeliveryNotePdf'

const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

interface Props { onBack: () => void }

interface ParsedItem {
  product_name: string
  department: string
  quantity: number
  unit_price: number
  total_price: number
}

interface SaleRow {
  id: number
  order_number: string | null
  order_date: string
  branch_id: number
  status: string
  total_amount: number
  confirmed_by: string | null
  completed_at: string | null
  created_at: string
}

interface SaleItemRow {
  id: number
  sale_id: number
  product_name: string
  department: string
  quantity_supplied: number
  quantity_confirmed: number | null
  unit_price: number
  total_price: number
}

interface QueueItem {
  fileName: string
  source: 'excel' | 'pdf'
  orderNumber: string
  orderDate: string
  branchId: number
  items: ParsedItem[]
  zeroItems: string[]
  // Result tracking after Save All
  status: 'ready' | 'saved' | 'duplicate' | 'error'
  statusMsg?: string
}

// Keep only Hebrew letters, latin word chars, and digits — strip whitespace,
// punctuation, dashes, RTL marks. Robust against spacing variants between
// the PDF text and the DB branch name.
function normName(s: string): string {
  return s.toLowerCase().replace(/[^֐-׿\w]/g, '')
}

// Fabios prints the building address, not our internal branch name. Each
// entry: alias text from the PDF → fragment of our DB branch name.
// Extend here if a new branch shows up under a different printed label.
const BRANCH_NAME_ALIASES: Array<[string, string]> = [
  ['עמק שרה', 'הפועלים'],
]

function matchBranchByName(branches: { id: number; name: string }[], hint: string | null): number {
  if (!hint) return 0
  let target = normName(hint)
  if (!target) return 0

  // Apply alias substitution before matching.
  for (const [src, dst] of BRANCH_NAME_ALIASES) {
    if (target.includes(normName(src))) {
      target = normName(dst)
      break
    }
  }

  const exact = branches.find(b => normName(b.name) === target)
  if (exact) return exact.id
  const contains = branches.find(b => normName(b.name).includes(target) || target.includes(normName(b.name)))
  return contains?.id || 0
}

async function enrichDepartments(items: ParsedItem[]): Promise<ParsedItem[]> {
  if (items.length === 0) return items
  const productNames = items.map(p => p.product_name)
  const [mapRes, prodRes] = await Promise.all([
    supabase.from('product_department_mapping').select('product_name, department'),
    supabase.from('production_reports')
      .select('product_name, department, report_date')
      .in('product_name', productNames)
      .order('report_date', { ascending: false }),
  ])
  const mainMap = new Map((mapRes.data || []).map((r: { product_name: string; department: string }) => [r.product_name, r.department]))
  const prodMap = new Map<string, string>()
  for (const row of (prodRes.data || []) as { product_name: string; department: string }[]) {
    if (!prodMap.has(row.product_name) && row.department && row.department !== 'אחר') {
      prodMap.set(row.product_name, row.department)
    }
  }
  return items.map(p => {
    const fromMap = mainMap.get(p.product_name)
    if (fromMap && fromMap !== 'אחר') return { ...p, department: fromMap }
    const fromProd = prodMap.get(p.product_name)
    if (fromProd) return { ...p, department: fromProd }
    return p
  })
}

const DEPT_OPTIONS = ['בצקים', 'קרמים', 'אריזה', 'ניקיון', 'שונות']
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'ממתין',   color: '#a16207', bg: '#fefce8' },
  modified:  { label: '⚠️ עודכן ע"י סניף', color: '#c2410c', bg: '#fff7ed' },
  completed: { label: 'הושלם',   color: '#166534', bg: '#f0fdf4' },
}

const S = {
  container: { padding: '24px 32px', maxWidth: 1060, margin: '0 auto' } as React.CSSProperties,
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' } as React.CSSProperties,
  btn: { border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  th: { fontSize: 12, fontWeight: 600, color: '#64748b', padding: '10px 8px', textAlign: 'right' as const, borderBottom: '2px solid #e2e8f0' },
  td: { fontSize: 13, color: '#1e293b', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' },
  tab: (active: boolean) => ({
    padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    border: 'none', borderBottom: active ? '2px solid #0f172a' : '2px solid transparent',
    background: 'none', color: active ? '#0f172a' : '#94a3b8',
  } as React.CSSProperties),
}
const fmtMoney = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })
const fmtDate = (d: string) => { const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}` }
const getCurrentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export default function InternalSalesUpload({ onBack }: Props) {
  const { appUser } = useAppUser()
  const { branches } = useBranches()
  const [tab, setTab] = useState<'upload' | 'history'>('upload')

  // ─── Upload state ───
  const [step, setStep] = useState<'upload' | 'queue' | 'preview' | 'saving' | 'done'>('upload')
  const [orderNumber, setOrderNumber] = useState('')
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0])
  const [selectedBranch, setSelectedBranch] = useState<number>(0)
  const [items, setItems] = useState<ParsedItem[]>([])
  const [zeroItems, setZeroItems] = useState<string[]>([])
  const [error, setError] = useState('')
  const [duplicateOrder, setDuplicateOrder] = useState<SaleRow | null>(null)
  const [parsing, setParsing] = useState(false)
  // Batch upload state: when >1 file is selected, we hold all parsed orders here.
  // queueIdx tracks which queue row is currently open in the single-preview UI.
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [queueIdx, setQueueIdx] = useState<number | null>(null)
  const [bulkSaving, setBulkSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── History state ───
  const [sales, setSales] = useState<SaleRow[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [filterMonth, setFilterMonth] = useState(getCurrentMonth())
  const [filterBranch, setFilterBranch] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterDept, setFilterDept] = useState<string>('all')
  const [viewSale, setViewSale] = useState<SaleRow | null>(null)
  const [viewItems, setViewItems] = useState<SaleItemRow[]>([])
  const [viewLoading, setViewLoading] = useState(false)
  const [editSale, setEditSale] = useState<SaleRow | null>(null)
  const [editItems, setEditItems] = useState<SaleItemRow[]>([])
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<SaleRow | null>(null)
  const [modifiedCount, setModifiedCount] = useState(0)

  // ─── Pure parsers — return parsed data, no state mutation ───
  // Excel: order_number in row 1, date in I6, items from row 7 onwards.
  async function parseExcelToData(file: File): Promise<{ orderNumber: string; orderDate: string; items: ParsedItem[]; zeroItems: string[] }> {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const data = new Uint8Array(buf)
    const wb = XLSX.read(data, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]

    const r1 = ws['A1'] || ws['B1']
    let oNum = ''
    if (r1) {
      const m = String(r1.v || '').match(/(\d+)/)
      if (m) oNum = m[1]
    }

    const dateCell = ws['I6']
    let dateStr = ''
    if (dateCell) {
      if (typeof dateCell.v === 'number') {
        const d = XLSX.SSF.parse_date_code(dateCell.v)
        dateStr = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
      } else {
        const raw = String(dateCell.v || '')
        const parts = raw.split('/')
        if (parts.length === 3) dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
    }

    const parsed: ParsedItem[] = []
    const zeros: string[] = []
    let rowIdx = 7
    while (true) {
      const nameCell = ws[`B${rowIdx}`]
      if (!nameCell || !nameCell.v || String(nameCell.v).trim() === '') break
      const product_name = String(nameCell.v).trim()
      const qty = Number(ws[`D${rowIdx}`]?.v || 0)
      const price = Number(ws[`F${rowIdx}`]?.v || 0)
      const total = Number(ws[`G${rowIdx}`]?.v || 0) || qty * price

      if (qty === 0) {
        zeros.push(product_name)
      } else {
        parsed.push({ product_name, department: 'אחר', quantity: qty, unit_price: price, total_price: total })
      }
      rowIdx++
    }

    return { orderNumber: oNum, orderDate: dateStr, items: parsed, zeroItems: zeros }
  }

  // PDF: Fabios delivery-note format. Branch is auto-detected from the
  // "לידי: מרטין - <branch>" line.
  async function parsePdfToData(file: File): Promise<{ orderNumber: string; orderDate: string; items: ParsedItem[]; zeroItems: string[]; branchHint: string | null }> {
    const parsed = await parseDeliveryNotePDF(file)
    const items: ParsedItem[] = parsed.items.map(i => ({
      product_name: i.product_name,
      department: 'אחר',
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.total_price,
    }))
    return {
      orderNumber: parsed.orderNumber || '',
      orderDate: parsed.orderDate || '',
      items,
      zeroItems: parsed.zeroItems,
      branchHint: parsed.branchHint,
    }
  }

  // Build a QueueItem from any supported file. Throws on parse failure;
  // the caller (handleFiles) catches and records the error per file.
  async function buildQueueItem(file: File): Promise<QueueItem> {
    const isPdf = /\.pdf$/i.test(file.name)
    let orderNumber = '', orderDate = '', branchId = 0
    let rawItems: ParsedItem[] = []
    let zeros: string[] = []
    if (isPdf) {
      const p = await parsePdfToData(file)
      orderNumber = p.orderNumber; orderDate = p.orderDate
      rawItems = p.items; zeros = p.zeroItems
      branchId = matchBranchByName(branches, p.branchHint)
    } else {
      const p = await parseExcelToData(file)
      orderNumber = p.orderNumber; orderDate = p.orderDate
      rawItems = p.items; zeros = p.zeroItems
    }
    if (rawItems.length === 0) {
      throw new Error('לא נמצאו מוצרים עם כמות גדולה מ-0')
    }
    const enriched = await enrichDepartments(rawItems)
    return {
      fileName: file.name,
      source: isPdf ? 'pdf' : 'excel',
      orderNumber,
      orderDate: orderDate || new Date().toISOString().split('T')[0],
      branchId,
      items: enriched,
      zeroItems: zeros,
      status: 'ready',
    }
  }

  // Pre-flight duplicate detection. Marks queue rows whose order_number
  // already exists in internal_sales OR is repeated within the same batch.
  // The save flow still re-checks via persistOrder; this is purely UX so the
  // user sees the conflict before clicking save.
  async function flagDuplicates(items: QueueItem[]): Promise<QueueItem[]> {
    const numbers = items
      .filter(q => q.status === 'ready' && q.orderNumber)
      .map(q => q.orderNumber)
    let existingSet = new Set<string>()
    if (numbers.length > 0) {
      const { data } = await supabase.from('internal_sales')
        .select('order_number').in('order_number', numbers)
      existingSet = new Set((data || []).map((r: { order_number: string | null }) => r.order_number || ''))
    }
    const seenInBatch = new Set<string>()
    return items.map(q => {
      if (q.status !== 'ready' || !q.orderNumber) return q
      if (existingSet.has(q.orderNumber)) {
        return { ...q, status: 'duplicate', statusMsg: `תעודה ${q.orderNumber} כבר קיימת — פתח לעדכון` }
      }
      if (seenInBatch.has(q.orderNumber)) {
        return { ...q, status: 'duplicate', statusMsg: `תעודה ${q.orderNumber} כפולה בתוך הבחירה` }
      }
      seenInBatch.add(q.orderNumber)
      return q
    })
  }

  // Top-level entry point from the file input. 1 file → straight to preview.
  // N files → batch into queue list with per-row review + "save all".
  async function handleFiles(files: File[]) {
    setError(''); setZeroItems([])
    if (files.length === 0) return
    setParsing(true)
    const built: QueueItem[] = []
    for (const f of files) {
      try {
        built.push(await buildQueueItem(f))
      } catch (err) {
        built.push({
          fileName: f.name,
          source: /\.pdf$/i.test(f.name) ? 'pdf' : 'excel',
          orderNumber: '', orderDate: '', branchId: 0,
          items: [], zeroItems: [],
          status: 'error',
          statusMsg: err instanceof Error ? err.message : String(err),
        })
      }
    }
    const checked = await flagDuplicates(built)
    setParsing(false)
    setQueue(checked)
    if (checked.length === 1) {
      // Same UX as before — straight to single preview (duplicate banner shown there).
      openFromQueue(0, checked)
    } else {
      setStep('queue')
    }
  }

  // Load a queue row into the single-preview state for review/edit.
  function openFromQueue(idx: number, source?: QueueItem[]) {
    const arr = source || queue
    const q = arr[idx]
    if (!q || q.status === 'error') return
    setQueueIdx(idx)
    setOrderNumber(q.orderNumber)
    setOrderDate(q.orderDate)
    setSelectedBranch(q.branchId)
    setItems(q.items)
    setZeroItems(q.zeroItems)
    setError('')
    setStep('preview')
  }

  // Push the current single-preview edits back into the queue row before
  // returning to the queue view.
  function commitPreviewToQueue() {
    if (queueIdx == null) return
    setQueue(prev => prev.map((q, i) => i === queueIdx ? {
      ...q,
      orderNumber, orderDate, branchId: selectedBranch, items, zeroItems,
    } : q))
  }

  function updateItem(idx: number, field: string, value: string | number) {
    setItems(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const u = { ...r, [field]: value }
      if (field === 'quantity' || field === 'unit_price') u.total_price = (Number(u.quantity) || 0) * (Number(u.unit_price) || 0)
      return u
    }))
  }

  // Pure save: no state mutation beyond DB. Used by both the single-preview
  // save and the batch "save all" so the persist logic stays in one place.
  type PersistInput = { orderNumber: string; orderDate: string; branchId: number; items: ParsedItem[] }
  type PersistResult =
    | { kind: 'ok'; saleId: number }
    | { kind: 'duplicate'; existing: SaleRow }
    | { kind: 'error'; message: string }

  async function persistOrder(data: PersistInput, opts: { overwriteId?: number; skipDuplicateCheck?: boolean } = {}): Promise<PersistResult> {
    if (!data.branchId) return { kind: 'error', message: 'יש לבחור סניף' }
    if (!data.orderDate) return { kind: 'error', message: 'יש להזין תאריך' }

    if (!opts.overwriteId && !opts.skipDuplicateCheck && data.orderNumber) {
      const { data: existing } = await supabase.from('internal_sales')
        .select('*').eq('order_number', data.orderNumber).maybeSingle()
      if (existing) return { kind: 'duplicate', existing: existing as SaleRow }
    }

    if (opts.overwriteId) {
      const { error: delErr } = await supabase.from('internal_sales').delete().eq('id', opts.overwriteId)
      if (delErr) {
        console.error('[InternalSalesUpload overwrite delete] error:', delErr)
        return { kind: 'error', message: `מחיקת ההזמנה הקודמת נכשלה: ${delErr.message || 'שגיאת מסד נתונים'}` }
      }
    }

    const totalAmount = data.items.reduce((s, i) => s + i.total_price, 0)
    const { data: sale, error: saleErr } = await supabase.from('internal_sales').insert({
      order_number: data.orderNumber || null,
      order_date: data.orderDate,
      branch_id: data.branchId,
      status: 'pending',
      total_amount: totalAmount,
      uploaded_by: appUser?.name || null,
    }).select().single()
    if (saleErr || !sale) return { kind: 'error', message: 'שמירת ההזמנה נכשלה: ' + (saleErr?.message || 'שגיאת מסד נתונים') }

    const itemPayload = data.items.map(i => ({
      sale_id: sale.id, product_name: i.product_name, department: i.department,
      quantity_supplied: i.quantity, unit_price: i.unit_price, total_price: i.total_price,
    }))
    const { error: itemsErr } = await supabase.from('internal_sale_items').insert(itemPayload)
    if (itemsErr) {
      console.error('[InternalSalesUpload items insert] error:', itemsErr)
      return { kind: 'error', message: `שמירת פריטים נכשלה: ${itemsErr.message || 'שגיאת מסד נתונים'}. ההזמנה ${sale.order_number || sale.id} נשמרה ריקה — ערוך מההיסטוריה.` }
    }

    // Best-effort department mapping upsert (non-fatal)
    const mappings = data.items.filter(i => i.department !== 'אחר').map(i => ({
      product_name: i.product_name, department: i.department,
    }))
    if (mappings.length > 0) {
      const { error: mapErr } = await supabase.from('product_department_mapping').upsert(mappings, { onConflict: 'product_name' })
      if (mapErr) console.warn('[InternalSalesUpload department mappings] non-fatal:', mapErr)
    }

    return { kind: 'ok', saleId: sale.id }
  }

  async function handleSave(overwriteId?: number) {
    setStep('saving')
    setDuplicateOrder(null)
    const r = await persistOrder(
      { orderNumber, orderDate, branchId: selectedBranch, items },
      { overwriteId },
    )
    if (r.kind === 'duplicate') { setDuplicateOrder(r.existing); setStep('preview'); return }
    if (r.kind === 'error') { setError(r.message + '. נסה שוב.'); setStep('preview'); return }

    // Success — in queue mode, mark this queue row saved and return to the queue list.
    if (queueIdx != null) {
      const savedIdx = queueIdx
      setQueue(prev => prev.map((q, i) => i === savedIdx ? { ...q, status: 'saved', statusMsg: undefined } : q))
      setQueueIdx(null)
      // If anything else still needs saving, return to queue; otherwise show "done".
      const hasMore = queue.some((q, i) => i !== savedIdx && q.status === 'ready')
      setStep(hasMore ? 'queue' : 'done')
    } else {
      setStep('done')
    }
  }

  async function saveAllQueue() {
    setBulkSaving(true)
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i]
      if (q.status !== 'ready') continue
      const r = await persistOrder(
        { orderNumber: q.orderNumber, orderDate: q.orderDate, branchId: q.branchId, items: q.items },
        {},
      )
      setQueue(prev => prev.map((x, idx) => {
        if (idx !== i) return x
        if (r.kind === 'ok') return { ...x, status: 'saved', statusMsg: undefined }
        if (r.kind === 'duplicate') return { ...x, status: 'duplicate', statusMsg: 'תעודה קיימת — פתח לעדכון ידני' }
        return { ...x, status: 'error', statusMsg: r.message }
      }))
    }
    setBulkSaving(false)
    loadModifiedCount()
  }

  function resetUpload() {
    setStep('upload'); setItems([]); setOrderNumber(''); setOrderDate(new Date().toISOString().split('T')[0])
    setSelectedBranch(0); setError(''); setZeroItems([]); setDuplicateOrder(null)
    setQueue([]); setQueueIdx(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ─── History ───
  const loadHistory = useCallback(async () => {
    setHistLoading(true)
    const [y, m] = filterMonth.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    if (filterDept !== 'all') {
      // Use inner join to filter by item department
      let q = supabase.from('internal_sales')
        .select('*, internal_sale_items!inner(department)')
        .eq('internal_sale_items.department', filterDept)
        .gte('order_date', from).lte('order_date', to)
        .order('order_date', { ascending: false })
      if (filterBranch !== 'all') q = q.eq('branch_id', Number(filterBranch))
      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      const { data } = await q
      // Deduplicate (inner join can return duplicates if multiple items match)
      const seen = new Set<number>()
      const unique = (data || []).filter((s: any) => {
        if (seen.has(s.id)) return false
        seen.add(s.id); return true
      })
      setSales(unique)
    } else {
      let q = supabase.from('internal_sales').select('*')
        .gte('order_date', from).lte('order_date', to).order('order_date', { ascending: false })
      if (filterBranch !== 'all') q = q.eq('branch_id', Number(filterBranch))
      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      const { data } = await q
      setSales(data || [])
    }
    setHistLoading(false)
  }, [filterMonth, filterBranch, filterStatus, filterDept])

  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  // Fetch modified count on mount + after changes
  const loadModifiedCount = useCallback(async () => {
    const { count } = await supabase.from('internal_sales')
      .select('id', { count: 'exact', head: true }).eq('status', 'modified')
    setModifiedCount(count || 0)
  }, [])
  useEffect(() => { loadModifiedCount() }, [loadModifiedCount])

  async function openView(sale: SaleRow) {
    setViewSale(sale); setViewLoading(true)
    const { data } = await supabase.from('internal_sale_items').select('*').eq('sale_id', sale.id).order('id')
    setViewItems(data || []); setViewLoading(false)
  }

  async function openEdit(sale: SaleRow) {
    setEditSale(sale); setEditLoading(true)
    const { data } = await supabase.from('internal_sale_items').select('*').eq('sale_id', sale.id).order('id')
    setEditItems(data || []); setEditLoading(false)
  }

  function updateEditItem(idx: number, field: string, value: string | number) {
    setEditItems(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const u = { ...r, [field]: value }
      if (field === 'quantity_supplied' || field === 'unit_price') u.total_price = (Number(u.quantity_supplied) || 0) * (Number(u.unit_price) || 0)
      return u
    }))
  }

  async function saveEdit() {
    if (!editSale) return
    setEditSaving(true)
    for (const item of editItems) {
      const { error } = await supabase.from('internal_sale_items').update({
        department: item.department, quantity_supplied: item.quantity_supplied,
        unit_price: item.unit_price, total_price: item.total_price,
      }).eq('id', item.id)
      if (error) {
        console.error('[InternalSalesUpload saveEdit item] error:', error)
        alert(`עדכון פריט ההזמנה נכשל: ${error.message || 'שגיאת מסד נתונים'}. חלק מהפריטים אולי לא נשמרו — בדוק.`)
        setEditSaving(false)
        return
      }
    }
    const newTotal = editItems.reduce((s, i) => s + Number(i.total_price), 0)
    const { error: totalErr } = await supabase.from('internal_sales').update({ total_amount: newTotal }).eq('id', editSale.id)
    if (totalErr) {
      console.error('[InternalSalesUpload saveEdit total] error:', totalErr)
      alert(`עדכון סך ההזמנה נכשל: ${totalErr.message || 'שגיאת מסד נתונים'}. הפריטים נשמרו אך הסכום הכולל לא — נסה שוב.`)
      setEditSaving(false)
      return
    }
    setEditSaving(false); setEditSale(null); setEditItems([]); loadHistory()
  }

  async function handleDelete(sale: SaleRow) {
    // For completed orders — also remove linked factory_sales + branch_expenses.
    // If any of these fail, abort before deleting the parent — better to leave
    // a completed sale half-deleted than orphan a child row in another table.
    if (sale.status === 'completed' && sale.order_number) {
      const { error: fsErr } = await supabase.from('factory_sales').delete()
        .eq('doc_number', sale.order_number).eq('is_internal', true)
      if (fsErr) {
        console.error('[InternalSalesUpload handleDelete factory_sales] error:', fsErr)
        alert(`מחיקת רישומי המפעל הקשורים נכשלה: ${fsErr.message || 'שגיאת מסד נתונים'}. ההזמנה לא נמחקה.`)
        return
      }
      const { error: beErr } = await supabase.from('branch_expenses').delete()
        .eq('branch_id', sale.branch_id).eq('from_factory', true)
        .eq('doc_number', sale.order_number)
      if (beErr) {
        console.error('[InternalSalesUpload handleDelete branch_expenses] error:', beErr)
        alert(`מחיקת רישומי הוצאות הסניף נכשלה: ${beErr.message || 'שגיאת מסד נתונים'}. ההזמנה לא נמחקה.`)
        return
      }
    }
    const { error } = await supabase.from('internal_sales').delete().eq('id', sale.id)
    if (error) {
      console.error('[InternalSalesUpload handleDelete sale] error:', error)
      alert(`מחיקת ההזמנה נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setDeleteConfirm(null); loadHistory(); loadModifiedCount()
  }

  async function completeModified(sale: SaleRow) {
    // Mark completed + record in factory_sales as internal
    const { error: statusErr } = await supabase.from('internal_sales').update({
      status: 'completed', completed_at: new Date().toISOString(),
      confirmed_by: appUser?.name || null,
    }).eq('id', sale.id)
    if (statusErr) {
      console.error('[InternalSalesUpload completeModified status] error:', statusErr)
      alert(`עדכון סטטוס ההזמנה נכשל: ${statusErr.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }

    // Add to factory_sales as internal revenue
    const { data: saleItems } = await supabase.from('internal_sale_items').select('*').eq('sale_id', sale.id)
    const finalTotal = (saleItems || []).reduce((s: number, i: any) => s + Number(i.total_price), 0)

    const { error: fsErr } = await supabase.from('factory_sales').insert({
      date: sale.order_date,
      department: sale.department || 'creams',
      customer: branches.find(b => b.id === sale.branch_id)?.name || '',
      amount: finalTotal,
      doc_number: sale.order_number,
      is_internal: true,
      target_branch_id: sale.branch_id,
      branch_status: 'approved',
    })
    if (fsErr) {
      console.error('[InternalSalesUpload completeModified factory_sales] error:', fsErr)
      alert(`רישום במכירות מפעל נכשל: ${fsErr.message || 'שגיאת מסד נתונים'}. ההזמנה סומנה הושלמה אך לא נספרה כהכנסה — פנה למנהל המערכת.`)
      return
    }

    // Add to branch_expenses — same column shape as BranchOrders.tsx
    // (expense_type / supplier / doc_number / notes), not category/description.
    const { error: beErr } = await supabase.from('branch_expenses').insert({
      branch_id: sale.branch_id,
      date: sale.order_date,
      expense_type: 'suppliers',
      supplier: 'מפעל ייצור',
      amount: finalTotal,
      doc_number: sale.order_number,
      from_factory: true,
      notes: `הזמנה ${sale.order_number || ''} מהמפעל`,
    })
    if (beErr) {
      console.error('[InternalSalesUpload completeModified branch_expenses] error:', beErr)
      alert(`רישום בהוצאות הסניף נכשל: ${beErr.message || 'שגיאת מסד נתונים'}. הסניף לא יראה את הרכישה ב-P&L — פנה למנהל המערכת.`)
      return
    }

    // Sync products catalog (best-effort — failures here don't block the order completion)
    if (saleItems) {
      for (const item of saleItems) {
        const price = Number(item.unit_price)
        const dept = item.department || null
        const { data: existing } = await supabase.from('products')
          .select('id, current_price').eq('product_name', item.product_name).maybeSingle()
        if (existing) {
          const { error: prodErr } = await supabase.from('products').update({
            last_price: existing.current_price,
            current_price: price,
            department: dept,
            price_updated_at: new Date().toISOString(),
          }).eq('id', existing.id)
          if (prodErr) console.warn('[InternalSalesUpload products update] non-fatal:', prodErr)
        } else {
          const { error: prodErr } = await supabase.from('products').insert({
            product_name: item.product_name,
            department: dept,
            current_price: price,
            price_updated_at: new Date().toISOString(),
          })
          if (prodErr) console.warn('[InternalSalesUpload products insert] non-fatal:', prodErr)
        }
        // Update department mapping
        if (dept) {
          const { error: mapErr } = await supabase.from('product_department_mapping')
            .upsert({ product_name: item.product_name, department: dept }, { onConflict: 'product_name' })
          if (mapErr) console.warn('[InternalSalesUpload mapping upsert] non-fatal:', mapErr)
        }
      }
    }

    loadHistory()
    loadModifiedCount()
  }

  async function rejectModified(sale: SaleRow) {
    // Reset quantities back to original (quantity_supplied) and set back to pending
    const { data: saleItems } = await supabase.from('internal_sale_items').select('*').eq('sale_id', sale.id)
    if (saleItems) {
      for (const item of saleItems) {
        const { error } = await supabase.from('internal_sale_items').update({
          quantity_confirmed: null,
          total_price: Number(item.quantity_supplied) * Number(item.unit_price),
        }).eq('id', item.id)
        if (error) {
          console.error('[InternalSalesUpload rejectModified item] error:', error)
          alert(`איפוס פריט ההזמנה נכשל: ${error.message || 'שגיאת מסד נתונים'}. חלק מהפריטים אולי באמצע — נסה שוב.`)
          return
        }
      }
      const originalTotal = saleItems.reduce((s: number, i: any) => s + Number(i.quantity_supplied) * Number(i.unit_price), 0)
      const { error: salErr } = await supabase.from('internal_sales').update({
        status: 'pending', total_amount: originalTotal, confirmed_by: null,
      }).eq('id', sale.id)
      if (salErr) {
        console.error('[InternalSalesUpload rejectModified sale] error:', salErr)
        alert(`החזרת ההזמנה לסטטוס "ממתין" נכשלה: ${salErr.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
        return
      }
    }
    setViewSale(null); setViewItems([]); loadHistory(); loadModifiedCount()
  }

  const branchName = (id: number) => branches.find(b => b.id === id)?.name || `סניף ${id}`
  const grandTotal = items.reduce((s, i) => s + i.total_price, 0)

  return (
    <motion.div dir="rtl" variants={fadeIn} initial="hidden" animate="visible">
      <PageHeader title="מכירות פנימיות" subtitle="העלאת תעודות משלוח לסניפים" onBack={onBack} />
      <div style={S.container}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e2e8f0', marginBottom: 20 }}>
          <button style={S.tab(tab === 'upload')} onClick={() => { setTab('upload'); setViewSale(null); setEditSale(null) }}>
            <Upload size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> העלאת תעודה
          </button>
          <button style={S.tab(tab === 'history')} onClick={() => { setTab('history'); setViewSale(null); setEditSale(null) }}>
            <History size={14} style={{ marginLeft: 6, verticalAlign: -2 }} /> היסטוריה
          </button>
        </div>

        {/* ─── Modified orders banner ─── */}
        {modifiedCount > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 18px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#c2410c' }}>
                  {modifiedCount} תעודות עודכנו על ידי סניפים וממתינות לאישורך
                </div>
                <div style={{ fontSize: 12, color: '#ea580c' }}>יש לבדוק את השינויים ולאשר או לדחות</div>
              </div>
            </div>
            <button onClick={() => { setTab('history'); setFilterStatus('modified'); setViewSale(null); setEditSale(null) }}
              style={{ ...S.btn, background: '#c2410c', color: 'white', padding: '8px 18px', fontSize: 13 }}>
              צפה עכשיו
            </button>
          </div>
        )}

        {/* ═══ UPLOAD TAB ═══ */}
        {tab === 'upload' && step === 'upload' && (
          <div style={S.card}>
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                <FileSpreadsheet size={42} color="#94a3b8" />
                <span style={{ color: '#cbd5e1', fontSize: 22 }}>·</span>
                <FileText size={42} color="#94a3b8" />
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>העלאת תעודת משלוח</h3>
              <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
                Excel (כותרות שורה 6, נתונים משורה 7) או PDF של תעודת משלוח מהמפעל. אפשר לבחור כמה קבצים יחד.
              </p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" multiple style={{ display: 'none' }}
                onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length > 0) handleFiles(fs) }} />
              <button onClick={() => fileRef.current?.click()} disabled={parsing}
                style={{ ...S.btn, background: parsing ? '#94a3b8' : '#0f172a', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Upload size={16} /> {parsing ? 'מנתח קבצים...' : 'בחר קבצים'}
              </button>
            </div>
            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#ef4444" /><span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
            </div>}
          </div>
        )}

        {/* ═══ QUEUE LIST (multi-file batch) ═══ */}
        {tab === 'upload' && step === 'queue' && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  תעודות שהועלו ({queue.filter(q => q.status === 'ready' || q.status === 'saved').length}/{queue.length})
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  בדוק כל תעודה, ערוך לפי הצורך, ולחץ "שמור הכל".
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetUpload} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                <button onClick={saveAllQueue} disabled={bulkSaving || queue.every(q => q.status !== 'ready')}
                  style={{ ...S.btn, background: bulkSaving ? '#94a3b8' : '#0f172a', color: 'white', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircle size={16} /> {bulkSaving ? 'שומר...' : 'שמור הכל'}
                </button>
              </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...S.th, width: 36 }}>#</th>
                <th style={S.th}>קובץ</th>
                <th style={S.th}>תעודה</th>
                <th style={S.th}>תאריך</th>
                <th style={S.th}>סניף</th>
                <th style={S.th}>פריטים</th>
                <th style={S.th}>סה"כ</th>
                <th style={S.th}>סטטוס</th>
                <th style={{ ...S.th, width: 90 }}></th>
              </tr></thead>
              <tbody>
                {queue.map((q, i) => {
                  const total = q.items.reduce((s, it) => s + it.total_price, 0)
                  const branchName = q.branchId ? (branches.find(b => b.id === q.branchId)?.name || `סניף ${q.branchId}`) : '—'
                  const statusBg = q.status === 'error' ? '#fef2f2'
                    : q.status === 'saved' ? '#f0fdf4'
                    : q.status === 'duplicate' ? '#fefce8'
                    : i % 2 === 0 ? 'white' : '#fafbfc'
                  const statusColor = q.status === 'error' ? '#dc2626'
                    : q.status === 'saved' ? '#166534'
                    : q.status === 'duplicate' ? '#a16207'
                    : '#64748b'
                  const statusLabel = q.status === 'error' ? 'שגיאה'
                    : q.status === 'saved' ? 'נשמר'
                    : q.status === 'duplicate' ? 'כפול'
                    : q.branchId ? 'מוכן' : 'בחר סניף'
                  return (
                    <tr key={i} style={{ background: statusBg }}>
                      <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {q.source === 'pdf' ? <FileText size={14} color="#94a3b8" /> : <FileSpreadsheet size={14} color="#94a3b8" />}
                          <span style={{ fontSize: 12 }}>{q.fileName}</span>
                        </div>
                      </td>
                      <td style={S.td}>{q.orderNumber || '—'}</td>
                      <td style={S.td}>{q.orderDate ? fmtDate(q.orderDate) : '—'}</td>
                      <td style={S.td}>{branchName}</td>
                      <td style={S.td}>{q.items.length}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{q.status === 'error' ? '—' : fmtMoney(total)}</td>
                      <td style={{ ...S.td }}>
                        <span style={{ color: statusColor, fontSize: 11, fontWeight: 700 }}>{statusLabel}</span>
                        {q.statusMsg && (
                          <div style={{ fontSize: 11, color: statusColor, marginTop: 2 }}>{q.statusMsg}</div>
                        )}
                      </td>
                      <td style={S.td}>
                        {q.status !== 'error' && (
                          <button onClick={() => openFromQueue(i)}
                            style={{ ...S.btn, padding: '4px 10px', fontSize: 11, background: '#f1f5f9', color: '#374151' }}>
                            פתח
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'upload' && step === 'preview' && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  תצוגה מקדימה {orderNumber && `— תעודה ${orderNumber}`}
                </h3>
                {queueIdx != null && (
                  <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
                    תעודה {queueIdx + 1} מתוך {queue.length}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {queueIdx != null && (
                  <button onClick={() => { commitPreviewToQueue(); setQueueIdx(null); setStep('queue') }}
                    style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronLeft size={14} /> חזרה לרשימה
                  </button>
                )}
                <button onClick={resetUpload} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
              </div>
            </div>

            {/* Branch + Date */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>סניף</label>
                <select value={selectedBranch} onChange={e => setSelectedBranch(Number(e.target.value))}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13, background: 'white', minWidth: 180 }}>
                  <option value={0}>בחר סניף...</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>תאריך</label>
                <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 13 }} />
              </div>
            </div>

            {queueIdx != null && queue[queueIdx]?.status === 'duplicate' && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#c2410c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} />
                {queue[queueIdx]?.statusMsg || `תעודה ${orderNumber} כבר קיימת במערכת`}. בלחיצה על "שמור הזמנה" תוצע אפשרות עדכון.
              </div>
            )}
            {zeroItems.length > 0 && (
              <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#a16207' }}>
                ⚠ {zeroItems.length} מוצרים בכמות 0 ולא יחושבו: {zeroItems.slice(0, 5).join(', ')}{zeroItems.length > 5 ? '...' : ''}
              </div>
            )}
            {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={14} />{error}
            </div>}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...S.th, width: 36 }}>#</th>
                  <th style={S.th}>מוצר</th>
                  <th style={{ ...S.th, width: 80 }}>כמות</th>
                  <th style={{ ...S.th, width: 110 }}>מחלקה</th>
                  <th style={{ ...S.th, width: 100 }}>מחיר מכירה</th>
                  <th style={{ ...S.th, width: 100 }}>סה"כ</th>
                </tr></thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                      <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                      <td style={S.td}>{item.product_name}</td>
                      <td style={S.td}>
                        <input type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', Number(e.target.value) || 0)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', textAlign: 'left' }} />
                      </td>
                      <td style={S.td}>
                        <select value={item.department} onChange={e => updateItem(i, 'department', e.target.value)}
                          style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', background: 'white' }}>
                          {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </td>
                      <td style={S.td}>₪{Number(item.unit_price).toFixed(2)}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(item.total_price)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td colSpan={5} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                  <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>{fmtMoney(grandTotal)}</td>
                </tr></tfoot>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => handleSave()} style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle size={16} /> שמור הזמנה
              </button>
              <button onClick={resetUpload} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        )}

        {tab === 'upload' && step === 'saving' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 14, color: '#64748b' }}>שומר הזמנה...</div>
          </div>
        )}

        {tab === 'upload' && step === 'done' && (
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 0' }}>
            <CheckCircle size={48} color="#10b981" style={{ marginBottom: 16 }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>ההזמנה נשמרה</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 24px' }}>
              תעודה {orderNumber} · {items.length} מוצרים · סטטוס: ממתין לאישור סניף
            </p>
            <button onClick={resetUpload} style={{ ...S.btn, background: '#0f172a', color: 'white' }}>העלאת תעודה נוספת</button>
          </div>
        )}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === 'history' && !viewSale && !editSale && (
          <div style={S.card}>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>חודש</label>
                <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>סניף</label>
                <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, background: 'white' }}>
                  <option value="all">כל הסניפים</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>מחלקה</label>
                <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, background: 'white' }}>
                  <option value="all">כל המחלקות</option>
                  {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b', display: 'block', marginBottom: 4 }}>סטטוס</label>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', fontSize: 13, background: 'white' }}>
                  <option value="all">הכל</option>
                  <option value="pending">ממתין</option>
                  <option value="modified">עודכן</option>
                  <option value="completed">הושלם</option>
                </select>
              </div>
            </div>

            {histLoading ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>טוען...</div>
            ) : sales.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 14 }}>אין הזמנות לתקופה זו</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={S.th}>תאריך</th>
                  <th style={S.th}>תעודה</th>
                  <th style={S.th}>סניף</th>
                  <th style={S.th}>סה"כ</th>
                  <th style={S.th}>סטטוס</th>
                  <th style={{ ...S.th, width: 130 }}></th>
                </tr></thead>
                <tbody>
                  {sales.map((s, i) => {
                    const st = STATUS_LABELS[s.status] || STATUS_LABELS.pending
                    const isModified = s.status === 'modified'
                    return (
                      <tr key={s.id} style={{ background: isModified ? '#fff7ed' : i % 2 === 0 ? 'white' : '#fafbfc', borderRight: isModified ? '3px solid #ea580c' : 'none' }}>
                        <td style={S.td}>{fmtDate(s.order_date)}</td>
                        <td style={S.td}>{s.order_number || '—'}</td>
                        <td style={S.td}>
                          {branchName(s.branch_id)}
                          {isModified && s.confirmed_by && (
                            <div style={{ fontSize: 11, color: '#ea580c', marginTop: 2 }}>עודכן ע"י: {s.confirmed_by}</div>
                          )}
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(s.total_amount)}</td>
                        <td style={S.td}>
                          <span style={{ background: st.bg, color: st.color, padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                            {st.label}
                          </span>
                          {isModified && (
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginTop: 4, animation: 'pulse 2s infinite' }}>
                              🔴 דורש אישורך
                            </div>
                          )}
                        </td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => openView(s)} style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: isModified ? '#fff7ed' : '#f1f5f9', color: '#374151', border: isModified ? '1px solid #fed7aa' : 'none' }} title="צפייה">
                              <Eye size={13} />
                            </button>
                            {s.status === 'pending' && (
                              <>
                                <button onClick={() => openEdit(s)} style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#f1f5f9', color: '#6366f1' }} title="עריכה">
                                  <Pencil size={13} />
                                </button>
                                <button onClick={() => setDeleteConfirm(s)} style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }} title="מחיקה">
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                            {isModified && (
                              <button onClick={() => openView(s)}
                                style={{ ...S.btn, padding: '3px 10px', fontSize: 11, background: '#c2410c', color: 'white' }}>
                                צפה ואשר
                              </button>
                            )}
                            {s.status === 'completed' && appUser?.role === 'admin' && (
                              <button onClick={() => setDeleteConfirm(s)} style={{ ...S.btn, padding: '3px 8px', fontSize: 11, background: '#fef2f2', color: '#ef4444' }} title="מחיקה">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* View detail / Comparison view for modified */}
        {tab === 'history' && viewSale && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                  {viewSale.status === 'modified' ? '⚠️ השוואת שינויים — ' : ''}הזמנה {viewSale.order_number || ''} — {fmtDate(viewSale.order_date)}
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
                  {branchName(viewSale.branch_id)} · {viewItems.length} מוצרים
                  {viewSale.status === 'modified' && viewSale.confirmed_by && (
                    <span style={{ color: '#ea580c', marginRight: 8 }}> · עודכן ע"י: {viewSale.confirmed_by}</span>
                  )}
                </p>
              </div>
              <button onClick={() => { setViewSale(null); setViewItems([]) }}
                style={{ ...S.btn, background: '#f1f5f9', color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ChevronLeft size={14} /> חזרה
              </button>
            </div>

            {viewSale.status === 'modified' && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#c2410c', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} />
                הסניף עדכן כמויות בהזמנה זו. בדוק את ההפרשים ואשר או דחה.
              </div>
            )}

            {viewLoading ? <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>טוען...</div> : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...S.th, width: 36 }}>#</th>
                    <th style={S.th}>מוצר</th>
                    <th style={S.th}>כמות מקורית (מפעל)</th>
                    {viewItems.some(i => i.quantity_confirmed !== null) && (
                      <>
                        <th style={S.th}>כמות מעודכנת (סניף)</th>
                        <th style={{ ...S.th, width: 80 }}>הפרש</th>
                      </>
                    )}
                    <th style={S.th}>מחיר</th>
                    <th style={S.th}>סה"כ {viewItems.some(i => i.quantity_confirmed !== null) ? 'מעודכן' : ''}</th>
                  </tr></thead>
                  <tbody>
                    {viewItems.map((item, i) => {
                      const hasConfirmed = item.quantity_confirmed !== null
                      const changed = hasConfirmed && item.quantity_confirmed !== item.quantity_supplied
                      const diff = hasConfirmed ? Number(item.quantity_confirmed) - Number(item.quantity_supplied) : 0
                      const effectiveQty = hasConfirmed ? Number(item.quantity_confirmed) : Number(item.quantity_supplied)
                      return (
                        <tr key={item.id} style={{ background: changed ? '#fff7ed' : i % 2 === 0 ? 'white' : '#fafbfc' }}>
                          <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                          <td style={S.td}>{item.product_name}</td>
                          <td style={{ ...S.td, color: changed ? '#94a3b8' : '#1e293b', textDecoration: changed ? 'line-through' : 'none' }}>
                            {item.quantity_supplied}
                          </td>
                          {viewItems.some(it => it.quantity_confirmed !== null) && (
                            <>
                              <td style={{ ...S.td, fontWeight: changed ? 700 : 400, color: changed ? '#c2410c' : '#1e293b' }}>
                                {hasConfirmed ? (
                                  changed ? (
                                    <span>{item.quantity_supplied} → {item.quantity_confirmed} {diff < 0 ? '↓' : '↑'}</span>
                                  ) : item.quantity_confirmed
                                ) : '—'}
                              </td>
                              <td style={{ ...S.td, fontWeight: 600, color: diff < 0 ? '#dc2626' : diff > 0 ? '#16a34a' : '#94a3b8', fontSize: 12 }}>
                                {changed ? (diff > 0 ? `+${diff}` : String(diff)) : '—'}
                              </td>
                            </>
                          )}
                          <td style={S.td}>₪{Number(item.unit_price).toFixed(2)}</td>
                          <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(effectiveQty * Number(item.unit_price))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    {viewItems.some(i => i.quantity_confirmed !== null) && (() => {
                      const originalTotal = viewItems.reduce((s, i) => s + Number(i.quantity_supplied) * Number(i.unit_price), 0)
                      const updatedTotal = viewItems.reduce((s, i) => s + (i.quantity_confirmed !== null ? Number(i.quantity_confirmed) : Number(i.quantity_supplied)) * Number(i.unit_price), 0)
                      const totalDiff = updatedTotal - originalTotal
                      const colCount = 5
                      return (
                        <>
                          <tr>
                            <td colSpan={colCount} style={{ ...S.td, fontWeight: 600, borderTop: '2px solid #e2e8f0', textAlign: 'left', color: '#94a3b8' }}>סה"כ מקורי</td>
                            <td colSpan={2} style={{ ...S.td, borderTop: '2px solid #e2e8f0', color: '#94a3b8' }}>{fmtMoney(originalTotal)}</td>
                          </tr>
                          <tr>
                            <td colSpan={colCount} style={{ ...S.td, fontWeight: 700, textAlign: 'left' }}>סה"כ מעודכן</td>
                            <td colSpan={2} style={{ ...S.td, fontWeight: 700, fontSize: 15 }}>{fmtMoney(updatedTotal)}</td>
                          </tr>
                          {totalDiff !== 0 && (
                            <tr>
                              <td colSpan={colCount} style={{ ...S.td, fontWeight: 600, textAlign: 'left', color: totalDiff < 0 ? '#dc2626' : '#16a34a' }}>הפרש</td>
                              <td colSpan={2} style={{ ...S.td, fontWeight: 700, color: totalDiff < 0 ? '#dc2626' : '#16a34a' }}>
                                {totalDiff > 0 ? '+' : ''}{fmtMoney(totalDiff)}
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })()}
                    {!viewItems.some(i => i.quantity_confirmed !== null) && (
                      <tr>
                        <td colSpan={3} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                        <td colSpan={2} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>
                          {fmtMoney(viewItems.reduce((s, i) => s + Number(i.total_price), 0))}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                </table>

                {/* Action buttons for modified orders */}
                {viewSale.status === 'modified' && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                    <button onClick={() => { completeModified(viewSale); setViewSale(null); setViewItems([]) }}
                      style={{ ...S.btn, background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CheckCircle size={16} /> אשר ושלם
                    </button>
                    <button onClick={() => rejectModified(viewSale)}
                      style={{ ...S.btn, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 8 }}>
                      ✕ דחה שינויים
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Edit modal */}
        {tab === 'history' && editSale && (
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                עריכת הזמנה {editSale.order_number || ''}
              </h3>
              <button onClick={() => { setEditSale(null); setEditItems([]) }}
                style={{ ...S.btn, background: '#f1f5f9', color: '#374151' }}>ביטול</button>
            </div>
            {editLoading ? <div style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>טוען...</div> : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ ...S.th, width: 36 }}>#</th>
                    <th style={S.th}>מוצר</th>
                    <th style={{ ...S.th, width: 110 }}>מחלקה</th>
                    <th style={{ ...S.th, width: 80 }}>כמות</th>
                    <th style={{ ...S.th, width: 90 }}>מחיר</th>
                    <th style={{ ...S.th, width: 100 }}>סה"כ</th>
                  </tr></thead>
                  <tbody>
                    {editItems.map((item, i) => (
                      <tr key={item.id} style={{ background: i % 2 === 0 ? 'white' : '#fafbfc' }}>
                        <td style={{ ...S.td, color: '#94a3b8', fontSize: 12 }}>{i + 1}</td>
                        <td style={S.td}>{item.product_name}</td>
                        <td style={S.td}>
                          <select value={item.department || ''} onChange={e => updateEditItem(i, 'department', e.target.value)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', background: 'white' }}>
                            {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                        </td>
                        <td style={S.td}>
                          <input type="number" value={item.quantity_supplied} onChange={e => updateEditItem(i, 'quantity_supplied', Number(e.target.value) || 0)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', textAlign: 'left' }} />
                        </td>
                        <td style={S.td}>
                          <input type="number" step="0.01" value={item.unit_price} onChange={e => updateEditItem(i, 'unit_price', Number(e.target.value) || 0)}
                            style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 6px', fontSize: 12, width: '100%', textAlign: 'left' }} />
                        </td>
                        <td style={{ ...S.td, fontWeight: 600 }}>{fmtMoney(item.total_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={5} style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', textAlign: 'left' }}>סה"כ</td>
                    <td style={{ ...S.td, fontWeight: 700, borderTop: '2px solid #e2e8f0', fontSize: 15 }}>
                      {fmtMoney(editItems.reduce((s, i) => s + Number(i.total_price), 0))}
                    </td>
                  </tr></tfoot>
                </table>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button onClick={saveEdit} disabled={editSaving}
                    style={{ ...S.btn, background: editSaving ? '#94a3b8' : '#0f172a', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle size={16} /> {editSaving ? 'שומר...' : 'שמור שינויים'}
                  </button>
                  <button onClick={() => { setEditSale(null); setEditItems([]) }}
                    style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 380, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>מחיקת הזמנה</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>
              {deleteConfirm.status === 'completed'
                ? 'מחיקת תעודה מושלמת תסיר גם את ההכנסה מהמפעל וההוצאה מהסניף. האם להמשיך?'
                : `למחוק הזמנה ${deleteConfirm.order_number || ''} מתאריך ${fmtDate(deleteConfirm.order_date)}?`
              }
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ ...S.btn, background: '#ef4444', color: 'white' }}>מחק</button>
              <button onClick={() => setDeleteConfirm(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate confirm */}
      {duplicateOrder && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDuplicateOrder(null)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 24, maxWidth: 400, margin: '0 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>תעודה כפולה</h3>
            <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px' }}>
              תעודה מספר {orderNumber} כבר קיימת במערכת. מה לעשות?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => handleSave(duplicateOrder.id)} style={{ ...S.btn, background: '#f59e0b', color: 'white' }}>עדכן</button>
              <button onClick={() => setDuplicateOrder(null)} style={{ ...S.btn, background: 'white', color: '#64748b', border: '1px solid #e2e8f0' }}>דלג</button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}
