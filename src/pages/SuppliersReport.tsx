import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import { useBranches } from '../lib/BranchContext'
import PageHeader from '../components/PageHeader'
import PeriodPicker from '../components/PeriodPicker'
import { Button } from '@/components/ui/button'
import { Sheet, SheetPortal, SheetBackdrop, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'

// Small, locally-defined input to match the project style; shadcn's Input isn't present.
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props
  return (
    <input
      {...rest}
      style={{
        border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px',
        fontSize: 14, outline: 'none', fontFamily: 'inherit',
        boxSizing: 'border-box', width: '100%',
        ...style,
      }}
    />
  )
}
import {
  ChevronDown, ChevronLeft, Download, Search, Plus, Trash2,
  Pencil, Merge, TrendingUp, TrendingDown, Tag, Factory, Store, X, Check,
  Sparkles, AlertCircle,
} from 'lucide-react'

interface Props { onBack: () => void; hideHeader?: boolean }

interface UnifiedSupplier {
  id: number
  canonical_name: string
  aliases: string[] | null
  category: string | null
  notes: string | null
  active: boolean
}

// One invoice-like row flattened from branch_expenses or supplier_invoices.
interface Invoice {
  key: string                // unique: e.g. "be:123" / "si:456"
  rawSupplier: string
  normalized: string         // normalized supplier name for matching
  scope: 'branch' | 'factory'
  branchId: number | null
  entityName: string
  amount: number
  date: string
  docNumber: string | null
}

interface EntityBreakdown {
  entityKey: string
  entityName: string
  scope: 'branch' | 'factory'
  branchId: number | null
  amount: number
  count: number
  docNumbers: string[]
}

interface SupplierGroup {
  unifiedId: number | null
  canonicalName: string
  aliases: string[]
  category: string | null
  total: number
  count: number
  invoices: Invoice[]
  byEntity: EntityBreakdown[]
  prevTotal: number
  mergeSuggestions: Array<{ existing: UnifiedSupplier; similarity: number }>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(s: string | null | undefined): string {
  if (!s) return ''
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const dp: number[] = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) dp[j] = j
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[b.length]
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (!maxLen) return 1
  return 1 - levenshtein(a, b) / maxLen
}

const fmtK = (n: number) => '₪' + Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 2 })

// Compute the previous period (same length, ending just before `from`).
function prevPeriod(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(from + 'T00:00:00').getTime()
  const toMs = new Date(to + 'T00:00:00').getTime()
  const span = toMs - fromMs
  const prevTo = new Date(fromMs).toISOString().slice(0, 10)
  const prevFrom = new Date(fromMs - span).toISOString().slice(0, 10)
  return { from: prevFrom, to: prevTo }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SuppliersReport({ onBack, hideHeader }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const { branches } = useBranches()

  const [unified, setUnified] = useState<UnifiedSupplier[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [prevInvoices, setPrevInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  // ─── Data loading ───────────────────────────────────────────────────────────
  async function loadUnified() {
    // Phase B: קוראים ישירות מ-suppliers_new (המקור הקנוני החדש).
    // aliases[] לא רלוונטי יותר — כל ספק הוא כבר unified.
    const { data } = await supabase.from('suppliers_new')
      .select('id, name, scope, branch_id, category, active, notes')
      .order('name')
    const mapped = (data || []).map((s: any) => ({
      id: s.id,
      canonical_name: s.name,
      aliases: [],
      category: s.category,
      notes: s.notes,
      active: s.active,
    })) as UnifiedSupplier[]
    setUnified(mapped)
  }

  async function loadInvoices(periodFrom: string, periodTo: string): Promise<Invoice[]> {
    const branchNameById: Record<number, string> = {}
    for (const b of branches) branchNameById[b.id] = b.name

    const [beRes, siRes] = await Promise.all([
      supabase.from('branch_expenses')
        .select('id, branch_id, supplier, amount, doc_number, date')
        .gte('date', periodFrom).lt('date', periodTo)
        .not('supplier', 'is', null)
        .range(0, 99999),
      supabase.from('supplier_invoices')
        .select('id, supplier_id, amount, doc_number, date, suppliers(name)')
        .gte('date', periodFrom).lt('date', periodTo)
        .range(0, 99999),
    ])

    const out: Invoice[] = []
    for (const r of (beRes.data || [])) {
      const raw = (r as any).supplier as string | null
      if (!raw || !raw.trim()) continue
      const branchId = (r as any).branch_id as number
      out.push({
        key: `be:${(r as any).id}`,
        rawSupplier: raw,
        normalized: normalizeName(raw),
        scope: 'branch',
        branchId,
        entityName: branchNameById[branchId] || `סניף ${branchId}`,
        amount: Number((r as any).amount),
        date: (r as any).date,
        docNumber: (r as any).doc_number || null,
      })
    }
    for (const r of (siRes.data || [])) {
      const supplierObj = (r as any).suppliers as { name: string } | null
      const raw = supplierObj?.name || null
      if (!raw || !raw.trim()) continue
      out.push({
        key: `si:${(r as any).id}`,
        rawSupplier: raw,
        normalized: normalizeName(raw),
        scope: 'factory',
        branchId: null,
        entityName: 'מפעל',
        amount: Number((r as any).amount),
        date: (r as any).date,
        docNumber: (r as any).doc_number || null,
      })
    }
    return out
  }

  async function loadAll() {
    if (branches.length === 0) return
    setLoading(true)
    const prev = prevPeriod(from, to)
    const [u, inv, prevInv] = await Promise.all([
      supabase.from('suppliers_new')
        .select('id, name, scope, branch_id, category, active, notes')
        .order('name'),
      loadInvoices(from, to),
      loadInvoices(prev.from, prev.to),
    ])
    const mappedU: UnifiedSupplier[] = (u.data || []).map((s: any) => ({
      id: s.id,
      canonical_name: s.name,
      aliases: [],
      category: s.category,
      notes: s.notes,
      active: s.active,
    }))
    setUnified(mappedU)
    setInvoices(inv)
    setPrevInvoices(prevInv)
    setLoading(false)
  }

  useEffect(() => { loadAll() }, [from, to, branches.length])

  // ─── Grouping ───────────────────────────────────────────────────────────────
  const groups = useMemo<SupplierGroup[]>(() => {
    // Build lookup: normalized alias/canonical → unified supplier
    const byNormalized = new Map<string, UnifiedSupplier>()
    for (const u of unified) {
      byNormalized.set(normalizeName(u.canonical_name), u)
      for (const a of (u.aliases || [])) {
        byNormalized.set(normalizeName(a), u)
      }
    }

    // Bucket invoices (current + prev) keyed by canonicalName
    type Bucket = {
      unifiedId: number | null
      canonicalName: string
      aliases: string[]
      category: string | null
      invoices: Invoice[]
      prevTotal: number
    }
    const buckets = new Map<string, Bucket>()

    function bucketKey(inv: Invoice): { key: string; bucket: Bucket } {
      const u = byNormalized.get(inv.normalized)
      if (u) {
        const canonical = u.canonical_name
        if (!buckets.has(canonical)) {
          buckets.set(canonical, {
            unifiedId: u.id,
            canonicalName: canonical,
            aliases: u.aliases || [],
            category: u.category,
            invoices: [],
            prevTotal: 0,
          })
        }
        return { key: canonical, bucket: buckets.get(canonical)! }
      }
      // Unassigned — each raw name is its own bucket (grouped by normalized, display by first-seen raw).
      const key = `__unassigned__:${inv.normalized}`
      if (!buckets.has(key)) {
        buckets.set(key, {
          unifiedId: null,
          canonicalName: inv.rawSupplier.trim(),
          aliases: [],
          category: null,
          invoices: [],
          prevTotal: 0,
        })
      }
      return { key, bucket: buckets.get(key)! }
    }

    for (const inv of invoices) {
      const { bucket } = bucketKey(inv)
      bucket.invoices.push(inv)
    }
    // Previous-period totals per bucket (match the same grouping rules)
    for (const inv of prevInvoices) {
      const { bucket } = bucketKey(inv)
      bucket.prevTotal += inv.amount
    }

    // For each bucket produce the display structure
    const result: SupplierGroup[] = []
    for (const b of buckets.values()) {
      const total = b.invoices.reduce((s, i) => s + i.amount, 0)
      const byEntityMap = new Map<string, EntityBreakdown>()
      for (const inv of b.invoices) {
        const k = inv.scope === 'factory' ? 'factory' : `branch-${inv.branchId}`
        const prev = byEntityMap.get(k)
        if (prev) {
          prev.amount += inv.amount
          prev.count += 1
          if (inv.docNumber) prev.docNumbers.push(inv.docNumber)
        } else {
          byEntityMap.set(k, {
            entityKey: k,
            entityName: inv.entityName,
            scope: inv.scope,
            branchId: inv.branchId,
            amount: inv.amount,
            count: 1,
            docNumbers: inv.docNumber ? [inv.docNumber] : [],
          })
        }
      }

      // Merge suggestions for unassigned: find unified suppliers with >80% similarity
      const mergeSuggestions: Array<{ existing: UnifiedSupplier; similarity: number }> = []
      if (b.unifiedId === null) {
        const candName = normalizeName(b.canonicalName)
        for (const u of unified) {
          const names = [u.canonical_name, ...(u.aliases || [])]
          let best = 0
          for (const n of names) {
            const sim = similarity(candName, normalizeName(n))
            if (sim > best) best = sim
          }
          if (best >= 0.8) mergeSuggestions.push({ existing: u, similarity: best })
        }
        mergeSuggestions.sort((a, b) => b.similarity - a.similarity)
      }

      result.push({
        unifiedId: b.unifiedId,
        canonicalName: b.canonicalName,
        aliases: b.aliases,
        category: b.category,
        total,
        count: b.invoices.length,
        invoices: b.invoices,
        byEntity: [...byEntityMap.values()].sort((a, b) => b.amount - a.amount),
        prevTotal: b.prevTotal,
        mergeSuggestions,
      })
    }
    // Sort by total desc
    result.sort((a, b) => b.total - a.total)
    return result
  }, [invoices, prevInvoices, unified])

  // ─── Filtered for main view (exclude fully-unassigned from main; they belong to manage modal) ──
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const g of groups) if (g.category) set.add(g.category)
    return [...set].sort()
  }, [groups])

  const visibleGroups = useMemo(() => {
    const s = normalizeName(search)
    return groups.filter(g => {
      // main list: show all groups; unassigned rows appear with tag
      if (categoryFilter && g.category !== categoryFilter) return false
      if (!s) return true
      const hay = normalizeName(g.canonicalName) + ' ' + g.aliases.map(normalizeName).join(' ')
      return hay.includes(s)
    })
  }, [groups, search, categoryFilter])

  const unassignedGroups = useMemo(() => groups.filter(g => g.unifiedId === null), [groups])

  // ─── Excel export ───────────────────────────────────────────────────────────
  function exportExcel() {
    const wb = XLSX.utils.book_new()

    // Sheet 1: summary per unified supplier
    const byEntityHeaders: string[] = []
    const entityColsMap: Record<string, string> = {}
    for (const b of branches) {
      const h = b.name
      byEntityHeaders.push(h)
      entityColsMap[`branch-${b.id}`] = h
    }
    byEntityHeaders.push('מפעל')
    entityColsMap['factory'] = 'מפעל'

    const summary = visibleGroups.map(g => {
      const row: Record<string, string | number> = {
        'שם ספק': g.canonicalName,
        'כינויים': g.aliases.join(', '),
        'קטגוריה': g.category || '',
        'סה"כ': Math.round(g.total),
        'מספר חשבוניות': g.count,
        'תקופה קודמת': Math.round(g.prevTotal),
        'שינוי %': g.prevTotal > 0 ? Number((((g.total - g.prevTotal) / g.prevTotal) * 100).toFixed(1)) : '',
        'סטטוס': g.unifiedId === null ? 'לא מאוחד' : 'מאוחד',
      }
      for (const h of byEntityHeaders) row[h] = 0
      for (const e of g.byEntity) {
        const col = entityColsMap[e.entityKey]
        if (col) row[col] = Math.round(e.amount)
      }
      return row
    })
    const ws1 = XLSX.utils.json_to_sheet(summary)
    XLSX.utils.book_append_sheet(wb, ws1, 'סיכום')

    // Sheet 2: all invoice details
    const detail: Array<Record<string, string | number>> = []
    for (const g of visibleGroups) {
      for (const inv of g.invoices) {
        detail.push({
          'תאריך': inv.date,
          'ספק מקורי': inv.rawSupplier,
          'ספק מאוחד': g.canonicalName,
          'סניף/מפעל': inv.entityName,
          'סכום': Math.round(inv.amount),
          'מספר חשבונית': inv.docNumber || '',
        })
      }
    }
    detail.sort((a, b) => String(a['תאריך']).localeCompare(String(b['תאריך'])))
    const ws2 = XLSX.utils.json_to_sheet(detail)
    XLSX.utils.book_append_sheet(wb, ws2, 'פירוט חשבוניות')

    XLSX.writeFile(wb, `suppliers_report_${from}_to_${to}.xlsx`)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: hideHeader ? 0 : '100vh', background: hideHeader ? 'transparent' : '#f8fafc', direction: 'rtl' }}>
      {!hideHeader && <PageHeader title="דוח ספקים מאוחד" onBack={onBack} />}

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: hideHeader ? 0 : '16px 20px 32px' }}>

        {/* Filters bar */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'white', borderRadius: 12, border: '1px solid #f1f5f9', padding: 14, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />

          <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
            <Search size={14} color="#94a3b8" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם ספק..." style={{ paddingRight: 32 }} />
          </div>

          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
            style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', fontSize: 14, background: 'white', fontFamily: 'inherit', minWidth: 140 }}>
            <option value="">כל הקטגוריות</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <Button variant="default" onClick={exportExcel}
            className="bg-indigo-500 hover:bg-indigo-600"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Download size={16} /> ייצוא Excel
          </Button>

          <Button variant="outline" onClick={() => setManageOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Merge size={16} /> ניהול ספקים מאוחדים
            {unassignedGroups.length > 0 && (
              <span style={{ background: '#fb7185', color: 'white', borderRadius: 999, fontSize: 11, padding: '1px 7px', fontWeight: 700 }}>
                {unassignedGroups.length}
              </span>
            )}
          </Button>
        </motion.div>

        {/* Loading / empty */}
        {loading && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>טוען...</div>}
        {!loading && visibleGroups.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', background: 'white', borderRadius: 12, border: '1px solid #f1f5f9' }}>
            אין נתוני ספקים לתקופה זו
          </div>
        )}

        {/* Supplier list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visibleGroups.map(g => {
            const isExpanded = expanded === g.canonicalName
            const diff = g.prevTotal > 0 ? ((g.total - g.prevTotal) / g.prevTotal) * 100 : null
            const up = diff !== null && diff > 0
            const DiffIcon = up ? TrendingUp : TrendingDown
            const diffColor = diff === null ? '#94a3b8' : (up ? '#fb7185' : '#34d399')

            return (
              <div key={g.canonicalName}
                style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.03)', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpanded(prev => prev === g.canonicalName ? null : g.canonicalName)}
                  style={{ width: '100%', border: 'none', background: 'transparent', padding: '14px 16px', cursor: 'pointer', textAlign: 'right', fontFamily: 'inherit' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    {isExpanded
                      ? <ChevronDown size={16} color="#94a3b8" />
                      : <ChevronLeft size={16} color="#94a3b8" />}
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{g.canonicalName}</span>
                        {g.unifiedId === null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '2px 8px', borderRadius: 999 }}>לא מאוחד</span>
                        )}
                        {g.category && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Tag size={10} /> {g.category}
                          </span>
                        )}
                      </div>
                      {g.aliases.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {g.aliases.map(a => (
                            <span key={a} style={{ fontSize: 10, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 8px', borderRadius: 999 }}>
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{fmtK(g.total)}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{g.count} חשבוניות</div>
                    </div>
                    {diff !== null && (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: diffColor, fontSize: 12, fontWeight: 700, minWidth: 70, justifyContent: 'flex-end' }}>
                        <DiffIcon size={13} /> {Math.abs(diff).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </button>

                {/* Per-entity breakdown */}
                <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {g.byEntity.map(e => (
                    <div key={e.entityKey} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', padding: '4px 0' }}>
                      {e.scope === 'factory'
                        ? <Factory size={13} color="#6366f1" />
                        : <Store size={13} color="#6366f1" />}
                      <span style={{ flex: 1 }}>{e.entityName}</span>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{fmtK(e.amount)}</span>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>({e.count} חשבוניות)</span>
                    </div>
                  ))}
                </div>

                {/* Expanded: invoice list */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #f1f5f9', background: '#fafbfc', padding: '10px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 140px 120px 100px', padding: '6px 0', fontSize: 11, fontWeight: 700, color: '#94a3b8', borderBottom: '1px solid #e2e8f0' }}>
                      <span>תאריך</span>
                      <span>סניף/מפעל</span>
                      <span>ספק מקורי</span>
                      <span>מס׳ חשבונית</span>
                      <span style={{ textAlign: 'left' }}>סכום</span>
                    </div>
                    {[...g.invoices].sort((a, b) => b.date.localeCompare(a.date)).map(inv => (
                      <div key={inv.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 140px 120px 100px', padding: '7px 0', fontSize: 13, color: '#475569', borderBottom: '1px solid #f1f5f9' }}>
                        <span>{new Date(inv.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                        <span>{inv.entityName}</span>
                        <span style={{ color: '#64748b' }}>{inv.rawSupplier}</span>
                        <span style={{ color: '#64748b' }}>{inv.docNumber || '—'}</span>
                        <span style={{ textAlign: 'left', fontWeight: 700, color: '#0f172a' }}>{fmtK(inv.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Manage modal */}
      <ManageSheet
        open={manageOpen}
        onOpenChange={setManageOpen}
        unified={unified}
        unassignedGroups={unassignedGroups}
        onRefresh={loadAll}
      />
    </div>
  )
}

// ─── Manage Sheet ─────────────────────────────────────────────────────────────
interface AnalysisResult {
  allNames: Array<{ display: string; count: number; assigned: boolean }>
  clusters: Array<{ canonical: string; members: string[]; totalCount: number }>
  createdCount: number
  skippedCount: number
  errors: string[]
}

function ManageSheet({ open, onOpenChange, unified, unassignedGroups, onRefresh }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  unified: UnifiedSupplier[]
  unassignedGroups: SupplierGroup[]
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'unassigned' | 'all' | 'auto'>('unassigned')
  const [newCanonical, setNewCanonical] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState<{ canonical: string; aliases: string; category: string }>({ canonical: '', aliases: '', category: '' })
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)

  async function runAutoAnalysis() {
    setAnalyzing(true)
    setAnalysis(null)
    try {
      // Step 1: fetch all supplier names from both sources
      const [beRes, siRes] = await Promise.all([
        supabase.from('branch_expenses').select('supplier').not('supplier', 'is', null).range(0, 99999),
        supabase.from('supplier_invoices').select('suppliers(name)').range(0, 99999),
      ])

      const counts = new Map<string, number>()
      const displayBy = new Map<string, string>()
      const addName = (raw: string | null | undefined) => {
        if (!raw) return
        const clean = String(raw).trim()
        if (!clean) return
        const norm = normalizeName(clean)
        counts.set(norm, (counts.get(norm) || 0) + 1)
        // prefer the longer/more-descriptive display form
        if (!displayBy.has(norm) || displayBy.get(norm)!.length < clean.length) {
          displayBy.set(norm, clean)
        }
      }
      for (const r of (beRes.data || [])) addName((r as any).supplier)
      for (const r of (siRes.data || [])) addName((r as any).suppliers?.name)

      // Mark which names are already assigned to an existing unified supplier
      const assignedNorm = new Set<string>()
      for (const u of unified) {
        assignedNorm.add(normalizeName(u.canonical_name))
        for (const a of (u.aliases || [])) assignedNorm.add(normalizeName(a))
      }

      const allNames = [...counts.entries()]
        .map(([norm, count]) => ({ norm, display: displayBy.get(norm)!, count, assigned: assignedNorm.has(norm) }))
        .sort((a, b) => b.count - a.count)

      // Step 2: cluster the unassigned names via union-find
      const unassignedNorms = allNames.filter(n => !n.assigned).map(n => n.norm)
      const parent = new Map<string, string>()
      const find = (x: string): string => {
        const p = parent.get(x)!
        if (p === x) return x
        const root = find(p)
        parent.set(x, root)
        return root
      }
      const unite = (a: string, b: string) => {
        const ra = find(a), rb = find(b)
        if (ra !== rb) parent.set(ra, rb)
      }
      for (const n of unassignedNorms) parent.set(n, n)

      for (let i = 0; i < unassignedNorms.length; i++) {
        for (let j = i + 1; j < unassignedNorms.length; j++) {
          const a = unassignedNorms[i], b = unassignedNorms[j]
          const shortLen = Math.min(a.length, b.length)
          if (shortLen < 3) continue
          // Substring containment — if one is contained in the other
          // (e.g. "בלקן" ⊂ "בית הבלקן", "ליאם" ⊂ "ליאם אריזות").
          if (shortLen >= 4 && (a.includes(b) || b.includes(a))) { unite(a, b); continue }
          // Edit distance of 1 — typos and missing space
          if (shortLen >= 3 && levenshtein(a, b) <= 1) { unite(a, b); continue }
          // Higher Levenshtein similarity on longer strings
          if (shortLen >= 4 && similarity(a, b) >= 0.85) unite(a, b)
        }
      }

      const clusterMap = new Map<string, string[]>()
      for (const n of unassignedNorms) {
        const root = find(n)
        const arr = clusterMap.get(root) || []
        arr.push(n)
        clusterMap.set(root, arr)
      }

      // Step 3: create suppliers_new rows (Phase B — aliases[] לא נשמר יותר, כל ספק עצמאי)
      const existingCanonicalNorms = new Set(unified.map(u => normalizeName(u.canonical_name)))
      const clustersOut: AnalysisResult['clusters'] = []
      const toInsert: Array<{ canonical_name: string; aliases: string[]; active: boolean }> = []
      for (const members of clusterMap.values()) {
        if (members.length === 0) continue
        const info = members.map(m => ({ norm: m, display: displayBy.get(m)!, count: counts.get(m) || 0 }))
        info.sort((a, b) => (b.count - a.count) || (b.display.length - a.display.length))
        const canonical = info[0].display
        const aliases = info.slice(1).map(m => m.display)
        const totalCount = info.reduce((s, m) => s + m.count, 0)
        clustersOut.push({ canonical, members: info.map(m => m.display), totalCount })
        if (!existingCanonicalNorms.has(normalizeName(canonical))) {
          toInsert.push({ canonical_name: canonical, aliases, active: true })
        }
      }
      clustersOut.sort((a, b) => b.totalCount - a.totalCount)

      // Insert ל-suppliers_new: scope='shared' (שייך לדוח הניהולי, לא לסניף ספציפי)
      let createdCount = 0, skippedCount = 0
      const errors: string[] = []
      for (const row of toInsert) {
        const { error } = await supabase.from('suppliers_new').insert({
          name: row.canonical_name,
          scope: 'shared',
          branch_id: null,
          active: row.active,
        })
        if (error) {
          skippedCount++
          if (!/duplicate|unique/i.test(error.message)) errors.push(`${row.canonical_name}: ${error.message}`)
        } else {
          createdCount++
        }
      }

      setAnalysis({ allNames, clusters: clustersOut, createdCount, skippedCount, errors })
      await onRefresh()
    } finally {
      setAnalyzing(false)
    }
  }

  // Phase B: aliases לא נשמר יותר ב-suppliers_new. ה-merge מתנוון בפונקציה ריקה (UI אולי ישים לב).
  async function mergeIntoExisting(unifiedId: number, rawName: string) {
    // No-op: aliases deprecated in Phase B. רשומות ספקים ב-suppliers_new הן עצמאיות.
    console.info('[SuppliersReport mergeIntoExisting] aliases deprecated (Phase B) — no DB change', { unifiedId, rawName })
    await onRefresh()
  }

  async function createUnifiedFromRaw(rawName: string) {
    if (!rawName.trim()) return
    const { error } = await supabase.from('suppliers_new').insert({
      name: rawName.trim(),
      scope: 'shared',
      branch_id: null,
      active: true,
    })
    if (error) { alert('שגיאה: ' + error.message); return }
    await onRefresh()
  }

  async function createUnifiedExplicit() {
    if (!newCanonical.trim()) return
    const { error } = await supabase.from('suppliers_new').insert({
      name: newCanonical.trim(),
      category: newCategory.trim() || null,
      scope: 'shared',
      branch_id: null,
      active: true,
    })
    if (error) { alert('שגיאה: ' + error.message); return }
    setNewCanonical(''); setNewCategory('')
    await onRefresh()
  }

  async function saveEdit(id: number) {
    // Phase B: aliases לא נשמר. שומרים רק name + category.
    const { error } = await supabase.from('suppliers_new').update({
      name: editDraft.canonical.trim(),
      category: editDraft.category.trim() || null,
    }).eq('id', id)
    if (error) {
      console.error('[SuppliersReport saveEdit] error:', error)
      alert(`עדכון פרטי ספק נכשל: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    setEditingId(null)
    await onRefresh()
  }

  async function deleteUnified(id: number) {
    if (!confirm('למחוק ספק מאוחד זה? (החשבוניות עצמן לא יושפעו)')) return
    const { error } = await supabase.from('suppliers_new').delete().eq('id', id)
    if (error) {
      console.error('[SuppliersReport deleteUnified] error:', error)
      alert(`מחיקת ספק מאוחד נכשלה: ${error.message || 'שגיאת מסד נתונים'}. נסה שוב.`)
      return
    }
    await onRefresh()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPortal>
        <SheetBackdrop />
        <SheetContent style={{ maxWidth: 720 }}>
          <SheetHeader>
            <SheetTitle>ניהול ספקים מאוחדים</SheetTitle>
          </SheetHeader>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f1f5f9', margin: '0 -20px 14px' }}>
            <TabButton active={tab === 'unassigned'} onClick={() => setTab('unassigned')}>
              לא מאוחדים ({unassignedGroups.length})
            </TabButton>
            <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
              כל הספקים המאוחדים ({unified.length})
            </TabButton>
            <TabButton active={tab === 'auto'} onClick={() => setTab('auto')}>
              ניתוח אוטומטי
            </TabButton>
          </div>

          {tab === 'unassigned' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unassignedGroups.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8' }}>
                  כל הספקים מאוחדים ✓
                </div>
              )}
              {unassignedGroups.map(g => (
                <div key={g.canonicalName} style={{ background: '#fafbfc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{g.canonicalName}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{fmtK(g.total)} · {g.count} חשבוניות</div>
                    </div>
                    <button onClick={() => createUnifiedFromRaw(g.canonicalName)}
                      style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Plus size={12} /> צור ספק חדש
                    </button>
                  </div>

                  {g.mergeSuggestions.length > 0 && (
                    <div style={{ marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Merge size={11} /> הצעות לאיחוד
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {g.mergeSuggestions.map(s => (
                          <div key={s.existing.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <span style={{ color: '#475569', flex: 1 }}>{s.existing.canonical_name}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', background: '#eef2ff', padding: '1px 6px', borderRadius: 999 }}>
                              {(s.similarity * 100).toFixed(0)}% דמיון
                            </span>
                            <button onClick={() => mergeIntoExisting(s.existing.id, g.canonicalName)}
                              style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                              <Check size={11} /> איחד
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === 'all' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* New supplier form */}
              <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Input value={newCanonical} onChange={e => setNewCanonical(e.target.value)} placeholder="שם קנוני..." style={{ flex: 2, minWidth: 180 }} />
                <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="קטגוריה (אופ׳)" style={{ flex: 1, minWidth: 140 }} />
                <Button onClick={createUnifiedExplicit} disabled={!newCanonical.trim()}
                  className="bg-indigo-500 hover:bg-indigo-600"
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Plus size={14} /> הוסף
                </Button>
              </div>

              {unified.map(u => {
                const isEditing = editingId === u.id
                return (
                  <div key={u.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                    {!isEditing ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{u.canonical_name}</div>
                          {u.category && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#475569', background: '#f1f5f9', padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 4 }}>
                              <Tag size={10} /> {u.category}
                            </span>
                          )}
                          {(u.aliases || []).length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {(u.aliases || []).map(a => (
                                <span key={a} style={{ fontSize: 10, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 8px', borderRadius: 999 }}>
                                  {a}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => { setEditingId(u.id); setEditDraft({ canonical: u.canonical_name, aliases: (u.aliases || []).join(', '), category: u.category || '' }) }}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Pencil size={15} color="#6366f1" />
                          </button>
                          <button onClick={() => deleteUnified(u.id)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <Trash2 size={15} color="#fb7185" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Input value={editDraft.canonical} onChange={e => setEditDraft({ ...editDraft, canonical: e.target.value })} placeholder="שם קנוני" />
                        <Input value={editDraft.aliases} onChange={e => setEditDraft({ ...editDraft, aliases: e.target.value })} placeholder="כינויים מופרדים בפסיק" />
                        <Input value={editDraft.category} onChange={e => setEditDraft({ ...editDraft, category: e.target.value })} placeholder="קטגוריה" />
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <Button variant="outline" onClick={() => setEditingId(null)}><X size={14} /> ביטול</Button>
                          <Button onClick={() => saveEdit(u.id)} className="bg-emerald-500 hover:bg-emerald-600"><Check size={14} /> שמור</Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'auto' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#3730a3', marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} /> ניתוח אוטומטי וייצור ספקים מאוחדים
                </div>
                <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.5, marginBottom: 10 }}>
                  שולף את כל שמות הספקים הייחודיים מ-<code>branch_expenses.supplier</code> ומ-<code>supplier_invoices</code> (דרך <code>suppliers.name</code>),
                  מזהה כפילויות (שמות זהים, הכלה, edit-distance ≤1, דמיון ≥85%), ויוצר רשומות ב-<code>unified_suppliers</code> עם aliases לכל הווריאציות.
                </div>
                <Button onClick={runAutoAnalysis} disabled={analyzing}
                  className="bg-indigo-500 hover:bg-indigo-600"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={14} /> {analyzing ? 'מנתח...' : 'הרץ ניתוח'}
                </Button>
              </div>

              {analysis && (
                <>
                  {/* Summary */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                    <Stat label="שמות ייחודיים" value={analysis.allNames.length} />
                    <Stat label="כבר מאוחדים" value={analysis.allNames.filter(n => n.assigned).length} />
                    <Stat label="אשכולות" value={analysis.clusters.length} />
                    <Stat label="נוצרו" value={analysis.createdCount} emphasis />
                  </div>

                  {analysis.errors.length > 0 && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 10, fontSize: 12, color: '#991b1b' }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <AlertCircle size={12} /> שגיאות
                      </div>
                      {analysis.errors.map((e, i) => <div key={i}>• {e}</div>)}
                    </div>
                  )}

                  {/* Clusters created */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                      אשכולות שזוהו ({analysis.clusters.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {analysis.clusters.map((c, i) => (
                        <div key={i} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{c.canonical}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{c.totalCount} הופעות</div>
                          </div>
                          {c.members.length > 1 && (
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {c.members.slice(1).map(m => (
                                <span key={m} style={{ fontSize: 10, color: '#64748b', background: 'white', border: '1px solid #e2e8f0', padding: '1px 7px', borderRadius: 999 }}>{m}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* All names with counts */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                      רשימה מלאה של שמות ייחודיים ({analysis.allNames.length})
                    </div>
                    <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f8fafc' }}>
                          <tr style={{ color: '#64748b', fontSize: 11, fontWeight: 700 }}>
                            <th style={{ padding: '6px 10px', textAlign: 'right' }}>שם ספק</th>
                            <th style={{ padding: '6px 10px', textAlign: 'center' }}>הופעות</th>
                            <th style={{ padding: '6px 10px', textAlign: 'center' }}>סטטוס</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.allNames.map(n => (
                            <tr key={n.display} style={{ borderTop: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '6px 10px', color: '#0f172a' }}>{n.display}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'center', color: '#475569', fontFamily: 'monospace' }}>{n.count}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                                {n.assigned
                                  ? <span style={{ fontSize: 10, fontWeight: 700, color: '#166534', background: '#dcfce7', padding: '1px 7px', borderRadius: 999 }}>מאוחד</span>
                                  : <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', background: '#fef3c7', padding: '1px 7px', borderRadius: 999 }}>חדש</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </SheetPortal>
    </Sheet>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div style={{ background: emphasis ? '#dcfce7' : 'white', border: '1px solid ' + (emphasis ? '#86efac' : '#e2e8f0'), borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: emphasis ? '#166534' : '#0f172a' }}>{value}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, padding: '10px 14px', border: 'none', background: 'transparent',
        fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        color: active ? '#6366f1' : '#94a3b8',
        borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
        marginBottom: -1,
      }}>
      {children}
    </button>
  )
}
