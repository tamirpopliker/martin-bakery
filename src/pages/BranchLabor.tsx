import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { usePeriod } from '../lib/PeriodContext'
import PeriodPicker from '../components/PeriodPicker'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight, Plus, Pencil, Trash2, CheckCircle, AlertTriangle, FileText, Eye, HelpCircle, BarChart3 } from 'lucide-react'
import { LaborIcon } from '@/components/icons'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import { parseWorkingHoursPDF } from '../lib/parseWorkingHours'

interface Props {
  branchId: number
  branchName: string
  branchColor: string
  onBack: () => void
}

interface ParsedRow {
  name: string
  date: string // YYYY-MM-DD or '' for summary rows
  hours_100: number; cost_100: number
  hours_125: number; cost_125: number
  hours_150: number; cost_150: number
  total_hours: number
  gross_salary: number
  employer_cost: number
  hourly_rate: number
  retention_bonus: number
  selected: boolean
}

interface Entry {
  id: number
  date: string
  employee_name: string
  hours: number
  gross_salary: number
  employer_cost: number
  notes: string | null
}

const EMPLOYER_FACTOR = 1.3

// ─── טעינת pdf.js ─────────────────────────────────────────────────────────────
function loadPdfJs(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) { resolve((window as any).pdfjsLib); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    s.onload = () => {
      const lib = (window as any).pdfjsLib
      lib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
      resolve(lib)
    }
    s.onerror = () => reject(new Error('נכשלה טעינת pdf.js'))
    document.head.appendChild(s)
  })
}

// ─── חילוץ items עם מיקום x,y ─────────────────────────────────────────────────
interface PdfItem { text: string; x: number; y: number }

async function extractPdfItems(file: File): Promise<PdfItem[]> {
  const lib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise
  const allItems: PdfItem[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items as any[]) {
      if (item.str?.trim()) {
        allItems.push({
          text: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        })
      }
    }
  }
  return allItems
}

// Extract items per page (for detailed format)
async function extractPdfItemsPerPage(file: File): Promise<PdfItem[][]> {
  const lib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise
  const pages: PdfItem[][] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: PdfItem[] = []
    for (const item of content.items as any[]) {
      if (item.str?.trim()) {
        items.push({ text: item.str.trim(), x: Math.round(item.transform[4]), y: Math.round(item.transform[5]) })
      }
    }
    pages.push(items)
  }
  return pages
}

// ─── קיבוץ items לשורות לפי y ────────────────────────────────────────────────
function groupByY(items: PdfItem[], tolerance = 4): Map<number, PdfItem[]> {
  const groups = new Map<number, PdfItem[]>()
  for (const item of items) {
    let matched = false
    for (const [key] of groups) {
      if (Math.abs(key - item.y) <= tolerance) {
        groups.get(key)!.push(item)
        matched = true
        break
      }
    }
    if (!matched) groups.set(item.y, [item])
  }
  // מיין כל שורה לפי x
  for (const [, row] of groups) row.sort((a, b) => a.x - b.x)
  return groups
}

// ─── פרסור CashOnTab לפי מיקום x ─────────────────────────────────────────────
// pdf.js מחזיר items עם x,y — משתמשים ב-x של התווית (שעות/כספי) כדי להפריד
// בין עמודות נתונים (שמאל) לפרטי עובד (ימין).
// עמודות נתונים x ascending: [סה"כ, שבת, 200%, 150%, 125%, 100%]
function parseCashOnTab(items: PdfItem[]): { rows: ParsedRow[]; rawLines: string[] } {
  const groups  = groupByY(items)
  const yKeys   = [...groups.keys()].sort((a, b) => b - a)
  const rawLines: string[] = []
  const rows: ParsedRow[] = []

  const toNum = (s: string) => parseFloat(s.replace(/,/g, '')) || 0
  const isHoursLbl = (t: string) => t === 'שעות' || t === 'תועש'
  const isCostLbl  = (t: string) => t === 'כספי' || t === 'יפסכ'
  const isLbl      = (t: string) => isHoursLbl(t) || isCostLbl(t)
  const isHebName  = (t: string) => /[\u05D0-\u05EA]{2,}/.test(t) && !isLbl(t)

  interface LineInfo {
    y: number; items: PdfItem[]; tokens: string[]
    isHours: boolean; isCost: boolean; labelX: number
  }
  const lines: LineInfo[] = []

  for (const y of yKeys) {
    const row    = groups.get(y)!
    const tokens = row.map(i => i.text)
    rawLines.push(tokens.join(' '))
    const isHours = tokens.some(isHoursLbl)
    const isCost  = tokens.some(isCostLbl)
    let labelX = -1
    for (const item of row) { if (isLbl(item.text)) { labelX = item.x; break } }
    lines.push({ y, items: row, tokens, isHours, isCost, labelX })
  }
  lines.sort((a, b) => b.y - a.y)   // מלמעלה למטה

  let i = 0
  while (i < lines.length) {
    if (!lines[i].isHours) { i++; continue }
    const hoursLine = lines[i]

    // מצא שורת כספי תואמת (עד 3 שורות למטה)
    let ci = -1
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (lines[j].isCost) { ci = j; break }
    }
    if (ci === -1) { i++; continue }
    const costLine = lines[ci]
    const lx = hoursLine.labelX >= 0 ? hoursLine.labelX : costLine.labelX
    if (lx < 0) { i = ci + 1; continue }

    // ── מצא שם עובד ─────────────────────────────────────
    let name = ''
    // 1) שורה נפרדת בין שעות לכספי
    for (let j = i + 1; j < ci; j++) {
      const heb = lines[j].items.filter(it => isHebName(it.text)).sort((a, b) => b.x - a.x)
      if (heb.length) { name = heb.map(it => it.text).join(' '); break }
    }
    // 2) צד ימין של שורת שעות (x > label)
    if (!name) {
      const heb = hoursLine.items.filter(it => it.x > lx && isHebName(it.text)).sort((a, b) => b.x - a.x)
      if (heb.length) name = heb.map(it => it.text).join(' ')
    }
    // 3) צד ימין של שורת כספי
    if (!name) {
      const heb = costLine.items.filter(it => it.x > lx && isHebName(it.text)).sort((a, b) => b.x - a.x)
      if (heb.length) name = heb.map(it => it.text).join(' ')
    }
    if (!name) { i = ci + 1; continue }

    // ── מספרי נתונים משמאל לתווית (x ascending) ─────────
    // עמודות: [סה"כ, שבת, 200%, 150%, 125%, 100%]
    const hNums = hoursLine.items
      .filter(it => it.x < lx && /^[\d,.]+$/.test(it.text))
      .sort((a, b) => a.x - b.x).map(it => toNum(it.text))
    const cNums = costLine.items
      .filter(it => it.x < lx && /^[\d,.]+$/.test(it.text))
      .sort((a, b) => a.x - b.x).map(it => toNum(it.text))

    // אינדקסים: 0=סה"כ  1=שבת  2=200%  3=150%  4=125%  5=100%
    const total_hours  = hNums[0] || 0
    const h100 = hNums[5] ?? (hNums.length > 1 ? hNums[hNums.length - 1] : 0)
    const h125 = hNums[4] ?? 0
    const h150 = hNums[3] ?? 0

    const gross_salary = cNums[0] || 0
    const c100 = cNums[5] ?? (cNums.length > 1 ? cNums[cNums.length - 1] : 0)
    const c125 = cNums[4] ?? 0
    const c150 = cNums[3] ?? 0

    if (name && gross_salary > 0) {
      rows.push({
        name, date: '',
        hours_100: h100, cost_100: c100,
        hours_125: h125, cost_125: c125,
        hours_150: h150, cost_150: c150,
        total_hours,
        gross_salary,
        employer_cost: parseFloat(((c100 * EMPLOYER_FACTOR) + c125 + c150).toFixed(2)),
        hourly_rate: 0,
        retention_bonus: 0,
        selected: true,
      })
    }
    i = ci + 1
  }

  return { rows, rawLines }
}

// ─── פרסור פורמט מפורט (כל עובד בדף נפרד) ──────────────────────────────────
// מחלץ שורה לכל יום לכל עובד (לא רק סיכום)
function parseDetailedFormat(pages: PdfItem[][]): { rows: ParsedRow[]; rawLines: string[] } {
  const rawLines: string[] = []
  const rows: ParsedRow[] = []
  const seenKeys = new Set<string>() // "name|date" dedup

  for (const pageItems of pages) {
    const fullText = pageItems.map(it => it.text).join(' ')
    rawLines.push(`--- PAGE ---`)
    rawLines.push(fullText.substring(0, 200))

    // Extract employee name
    const nameMatch = fullText.match(/שם עובד:\s*([^\n]+?)(?:\s+קוד|\s+מחסנים|\s+תאריך)/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim().replace(/\s+/g, ' ')
    if (!name) continue

    // Group by Y and sort top-to-bottom
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a) // high Y = top

    // Find daily rows: lines that contain a date DD/MM/YYYY and numbers
    for (const y of yKeys) {
      const row = groups.get(y)!
      const texts = row.map(i => i.text)
      const lineText = texts.join(' ')

      // Skip summary lines
      if (lineText.includes('סיכום') || lineText.includes('סה"כ') || lineText.includes('CashOnTab')) continue

      // Look for date pattern DD/MM/YYYY
      const dateToken = texts.find(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t))
      if (!dateToken) continue

      // Parse date DD/MM/YYYY → YYYY-MM-DD
      const [dd, mm, yyyy] = dateToken.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`
      const key = `${name}|${dateStr}`
      if (seenKeys.has(key)) continue

      // Extract numbers from line (excluding dates DD/MM/YYYY and times HH:MM)
      const nums = row
        .filter(it => !/^\d{2}\/\d{2}\/\d{4}$/.test(it.text) && !/^\d{2}:\d{2}$/.test(it.text))
        .filter(it => /^[\d,.]+$/.test(it.text.replace(/,/g, '')))
        .map(it => parseFloat(it.text.replace(/,/g, '')))
        .filter(v => !isNaN(v))

      if (nums.length < 3) continue

      // Filter to hour-range values only (0–24)
      const hourNums = nums.filter(v => v >= 0 && v <= 24)
      if (hourNums.length < 2) continue

      // Strategy: find סה"כ שעות as the number that equals the sum of other numbers in the row
      // This is the ONLY reliable way because קופה (0-999) and סוג דיווח (0-10)
      // can overlap with valid hour values
      //
      // For each candidate totalH (sorted descending), check if remaining numbers
      // contain a subset that sums to totalH. The first match wins.
      const candidates = [...new Set(hourNums)].filter(v => v > 0).sort((a, b) => b - a)

      let totalH = 0, finalH100 = 0, finalH125 = 0, finalH150 = 0
      let found = false

      for (const candidateTotal of candidates) {
        if (found) break
        // Build remaining list (remove one instance of candidateTotal)
        const rest = [...hourNums]
        const idx = rest.indexOf(candidateTotal)
        if (idx >= 0) rest.splice(idx, 1)
        rest.sort((a, b) => b - a)

        // Try combinations: prefer 3-value > 2-value > 1-value (more parts = more likely real hours)
        // This prevents false matches like קופה(10) + רמה2(0.48) = 10.48

        // Phase 1: Try 3 values
        for (let i = 0; i < rest.length && !found; i++) {
          for (let j = i + 1; j < rest.length && !found; j++) {
            for (let k = j + 1; k < rest.length && !found; k++) {
              if (Math.abs(rest[i] + rest[j] + rest[k] - candidateTotal) < 0.1) {
                totalH = candidateTotal; finalH100 = rest[i]; finalH125 = rest[j]; finalH150 = rest[k]
                found = true
              }
            }
          }
        }
        // Phase 2: Try 2 values (only if no 3-value match found)
        for (let i = 0; i < rest.length && !found; i++) {
          for (let j = i + 1; j < rest.length && !found; j++) {
            if (Math.abs(rest[i] + rest[j] - candidateTotal) < 0.1) {
              totalH = candidateTotal; finalH100 = rest[i]; finalH125 = rest[j]
              found = true
            }
          }
        }
        // Phase 3: Try single value
        for (let i = 0; i < rest.length && !found; i++) {
          if (Math.abs(rest[i] - candidateTotal) < 0.1) {
            totalH = candidateTotal; finalH100 = rest[i]
            found = true
          }
        }
      }

      // Fallback: largest value as totalH, all in 100%
      if (!found) {
        totalH = Math.max(...hourNums.filter(v => v > 0))
        if (totalH <= 0) continue
        finalH100 = totalH
      }

      seenKeys.add(key)
      rows.push({
        name, date: dateStr,
        hours_100: finalH100, cost_100: 0,
        hours_125: finalH125, cost_125: 0,
        hours_150: finalH150, cost_150: 0,
        total_hours: totalH,
        gross_salary: 0, employer_cost: 0,
        hourly_rate: 0, retention_bonus: 0,
        selected: true,
      })
    }
  }

  // Sort by name, then date
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))
  return { rows, rawLines }
}

// ─── Animation variants ──────────────────────────────────────────────────────
const fadeIn = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } } }

// ─── קומפוננטה ────────────────────────────────────────────────────────────────
export default function BranchLabor({ branchId, branchName, branchColor, onBack }: Props) {
  const { period, setPeriod, from, to } = usePeriod()
  const [entries, setEntries]           = useState<Entry[]>([])
  const [editId, setEditId]             = useState<number | null>(null)
  const [editData, setEditData]         = useState<Partial<Entry>>({})
  const [loading, setLoading]           = useState(false)
  const [monthRevenue, setMonthRevenue] = useState(0)
  const [tab, setTab]                   = useState<'upload' | 'manual' | 'history' | 'daily_report'>('upload')
  const [helpOpen, setHelpOpen]         = useState(false)

  // Daily report
  interface DailyRow { date: string; employees: number; hours100: number; hours125: number; hours150: number; gross: number; employer: number }
  const [dailyData, setDailyData] = useState<DailyRow[]>([])
  const [dailyLoading, setDailyLoading] = useState(false)
  const [laborTargetPct, setLaborTargetPct] = useState(28)

  // העלאה
  const [parsedRows, setParsedRows]     = useState<ParsedRow[]>([])
  const [uploadDate, setUploadDate]     = useState(new Date().toISOString().split('T')[0])
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'parsing' | 'confirm' | 'done' | 'error'>('idle')
  const [uploadMsg, setUploadMsg]       = useState('')
  const [rawLines, setRawLines]         = useState<string[]>([])
  const [showRaw, setShowRaw]           = useState(false)
  const [hourlyRate, setHourlyRate]     = useState('35')

  // הזנה ידנית
  const [manDate, setManDate]   = useState(new Date().toISOString().split('T')[0])
  const [manName, setManName]   = useState('')
  const [manHours, setManHours] = useState('')
  const [manGross, setManGross] = useState('')
  const [manNotes, setManNotes] = useState('')

  async function fetchEntries() {
    const { data } = await supabase.from('branch_labor').select('*')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function fetchRevenue() {
    const { data } = await supabase.from('branch_revenue').select('amount')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
    if (data) setMonthRevenue(data.reduce((s: number, r: any) => s + Number(r.amount), 0))
  }

  async function fetchLaborTarget() {
    const { data } = await supabase.from('branch_kpi_targets').select('labor_pct').eq('branch_id', branchId).single()
    if (data) setLaborTargetPct(Number(data.labor_pct) || 28)
  }

  useEffect(() => { fetchEntries(); fetchRevenue(); fetchLaborTarget() }, [from, to, branchId])

  async function fetchDailyReport() {
    setDailyLoading(true)
    const { data } = await supabase.from('branch_labor').select('date, hours, gross_salary, employer_cost, notes')
      .eq('branch_id', branchId)
      .gte('date', from).lt('date', to)
      .order('date')
    if (data) {
      const byDate: Record<string, DailyRow> = {}
      for (const r of data) {
        if (!byDate[r.date]) byDate[r.date] = { date: r.date, employees: 0, hours100: 0, hours125: 0, hours150: 0, gross: 0, employer: 0 }
        byDate[r.date].employees++
        // Parse hours breakdown from notes field: "100%: 8.5ש׳ | 125%: 1.5ש׳"
        const notes = r.notes || ''
        const m100 = notes.match(/100%:\s*([\d.]+)/)
        const m125 = notes.match(/125%:\s*([\d.]+)/)
        const m150 = notes.match(/150%:\s*([\d.]+)/)
        byDate[r.date].hours100 += m100 ? parseFloat(m100[1]) : Number(r.hours || 0)
        byDate[r.date].hours125 += m125 ? parseFloat(m125[1]) : 0
        byDate[r.date].hours150 += m150 ? parseFloat(m150[1]) : 0
        byDate[r.date].gross += Number(r.gross_salary || 0)
        byDate[r.date].employer += Number(r.employer_cost || 0)
      }
      setDailyData(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
    }
    setDailyLoading(false)
  }

  useEffect(() => { if (tab === 'daily_report') fetchDailyReport() }, [tab, from, to, branchId])

  // ─── handleFile ───────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!file) return
    setUploadStatus('parsing')
    setUploadMsg('טוען pdf.js ומחלץ...')
    setParsedRows([]); setRawLines([]); setShowRaw(false)

    try {
      const items = await extractPdfItems(file)

      // Try מרוכז format first
      let { rows, rawLines: lines } = parseCashOnTab(items)
      let isDetailed = false

      // If מרוכז didn't find anything, try מפורט (summary-based)
      if (rows.length === 0) {
        const { employees, rawPages } = await parseWorkingHoursPDF(file)
        lines = rawPages

        if (employees.length > 0) {
          isDetailed = true
          rows = employees.map(emp => ({
            name: emp.name,
            date: emp.date,
            hours_100: emp.hours_100,
            cost_100: 0,
            hours_125: emp.hours_125,
            cost_125: 0,
            hours_150: emp.hours_150,
            cost_150: 0,
            total_hours: emp.total_hours,
            gross_salary: 0,
            employer_cost: 0,
            hourly_rate: 0,
            retention_bonus: 0,
            selected: true,
          }))
        }
      }

      setRawLines(lines)

      // Auto-fill hourly_rate + retention_bonus from branch_employees
      if (rows.length > 0) {
        const { data: emps } = await supabase.from('branch_employees').select('*')
          .eq('branch_id', branchId).eq('active', true)
        if (emps) {
          for (const row of rows) {
            const match = emps.find((e: any) => row.name.includes(e.name) || e.name.includes(row.name))
            if (match) {
              row.hourly_rate = Number(match.hourly_rate) || 0
              row.retention_bonus = Number(match.retention_bonus) || 0
            }
          }
        }
      }

      if (rows.length === 0) {
        setUploadStatus('error')
        setUploadMsg('לא זוהו עובדים — לחץ "טקסט גולמי" לבדיקה')
        setShowRaw(true)
        return
      }

      setParsedRows(rows)
      setUploadStatus('confirm')
      const uniqueNames = new Set(rows.map(r => r.name)).size
      setUploadMsg(isDetailed
        ? `זוהו ${uniqueNames} עובדים · ${rows.length} שורות יומיות (הזן תעריף שעתי לחישוב שכר)`
        : `זוהו ${rows.length} עובדים — בדוק ואשר`)
    } catch (err: any) {
      setUploadStatus('error')
      setUploadMsg('שגיאה: ' + (err.message || 'נסה שוב'))
    }
  }

  // ─── שמירה ────────────────────────────────────────────────────────────────
  async function saveSelected() {
    // Recalculate salary inside save (don't rely on render-phase mutation)
    const selected = parsedRows.filter(r => r.selected)
    const toSave: typeof parsedRows = []
    for (const r of selected) {
      const rate = r.hourly_rate || 0
      if (rate > 0 && r.total_hours > 0) {
        const c100 = r.hours_100 * rate
        const c125 = r.hours_125 * rate * 1.25
        const c150 = r.hours_150 * rate * 1.5
        const bonusAmount = r.total_hours * (r.retention_bonus || 0)
        const gross = parseFloat((c100 + c125 + c150 + bonusAmount).toFixed(2))
        const empCost = parseFloat(((c100 * EMPLOYER_FACTOR) + c125 + c150 + bonusAmount).toFixed(2))
        toSave.push({ ...r, gross_salary: gross, employer_cost: empCost, cost_100: c100, cost_125: c125, cost_150: c150 })
      } else if (r.gross_salary > 0) {
        toSave.push(r)
      }
    }
    if (!toSave.length) {
      setUploadStatus('error')
      setUploadMsg('אין שורות עם שכר לשמירה — הזן תעריף שעתי')
      return
    }
    setLoading(true)

    try {
      // Build all payloads
      const payloads = toSave.map(r => ({
        branch_id: branchId,
        date: r.date || uploadDate,
        employee_name: r.name,
        hours: r.total_hours,
        gross_salary: r.gross_salary,
        employer_cost: r.employer_cost,
        notes: [
          r.hours_100 > 0 ? `100%: ${r.hours_100}ש׳` : '',
          r.hours_125 > 0 ? `125%: ${r.hours_125}ש׳` : '',
          r.hours_150 > 0 ? `150%: ${r.hours_150}ש׳` : '',
        ].filter(Boolean).join(' | ')
      }))

      // Get all unique dates in the payload
      const dates = [...new Set(payloads.map(p => p.date))]

      // Delete existing rows for these dates + branch (batch replace)
      for (const d of dates) {
        await supabase.from('branch_labor').delete()
          .eq('branch_id', branchId).eq('date', d)
      }

      // Batch insert in chunks of 50
      let saved = 0
      for (let i = 0; i < payloads.length; i += 50) {
        const chunk = payloads.slice(i, i + 50)
        const { error } = await supabase.from('branch_labor').insert(chunk)
        if (error) {
          console.error('Batch insert error:', error)
          setUploadStatus('error')
          setUploadMsg(`שגיאה בשמירה: ${error.message}`)
          setLoading(false)
          return
        }
        saved += chunk.length
      }

      // Auto-save new employees to branch_employees
      // Save ALL unique employees (even with rate=0) so they appear in the employees page
      const uniqueEmps = new Map<string, number>()
      for (const r of toSave) {
        if (!uniqueEmps.has(r.name)) {
          uniqueEmps.set(r.name, r.hourly_rate || 0)
        }
      }
      let newEmps = 0
      const { data: existingEmps } = await supabase.from('branch_employees')
        .select('name').eq('branch_id', branchId)
      const existingNames = (existingEmps || []).map((e: any) => e.name.toLowerCase())
      const newEmpPayloads: any[] = []
      for (const [name, rate] of uniqueEmps) {
        if (!existingNames.some((n: string) => name.toLowerCase().includes(n) || n.includes(name.toLowerCase()))) {
          // Don't include retention_bonus — it has DEFAULT 0 and may cause 400 if column not cached
          newEmpPayloads.push({ branch_id: branchId, name, hourly_rate: rate, active: true })
        }
      }
      if (newEmpPayloads.length > 0) {
        const { error: empErr } = await supabase.from('branch_employees').insert(newEmpPayloads)
        if (empErr) {
          console.error('branch_employees insert error:', empErr)
        } else {
          newEmps = newEmpPayloads.length
        }
      }

      setParsedRows([]); setUploadStatus('done')
      setUploadMsg(`✓ נשמרו ${saved} רשומות` + (newEmps > 0 ? ` · ${newEmps} עובדים חדשים נוספו למערכת` : ''))
      await fetchEntries()
    } catch (err: any) {
      console.error('Save error:', err)
      setUploadStatus('error')
      setUploadMsg('שגיאה: ' + (err.message || 'נסה שוב'))
    }
    setLoading(false)
  }

  // ─── הזנה ידנית ───────────────────────────────────────────────────────────
  async function addManual() {
    if (!manName || !manGross) return
    setLoading(true)
    const gross = parseFloat(manGross)
    await supabase.from('branch_labor').insert({
      branch_id: branchId, date: manDate,
      employee_name: manName,
      hours: parseFloat(manHours) || 0,
      gross_salary: gross,
      employer_cost: parseFloat((gross * EMPLOYER_FACTOR).toFixed(2)),
      notes: manNotes || null
    })
    setManName(''); setManHours(''); setManGross(''); setManNotes('')
    await fetchEntries(); setLoading(false)
  }

  async function deleteEntry(id: number) {
    if (!confirm('למחוק?')) return
    await supabase.from('branch_labor').delete().eq('id', id)
    await fetchEntries()
  }

  async function saveEdit(id: number) {
    const upd = { ...editData, employer_cost: parseFloat((Number(editData.gross_salary || 0) * EMPLOYER_FACTOR).toFixed(2)) }
    await supabase.from('branch_labor').update(upd).eq('id', id)
    setEditId(null); await fetchEntries()
  }

  // חישובים
  const totalGross    = entries.reduce((s, e) => s + Number(e.gross_salary), 0)
  const totalEmployer = entries.reduce((s, e) => s + Number(e.employer_cost), 0)
  const totalHours    = entries.reduce((s, e) => s + Number(e.hours), 0)
  const laborPct      = monthRevenue > 0 ? (totalEmployer / monthRevenue) * 100 : 0
  const kpiOk         = laborPct <= laborTargetPct
  const parsedTotal   = parsedRows.filter(r => r.selected).reduce((s, r) => s + r.gross_salary, 0)
  const parsedEmpTotal = parsedRows.filter(r => r.selected).reduce((s, r) => s + r.employer_cost, 0)

  const S = {
    label: { fontSize: '13px', fontWeight: '600' as const, color: '#64748b', marginBottom: '6px', display: 'block' },
    input: { border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const },
  }

  const statusColor = uploadStatus === 'error' ? '#fb7185' : uploadStatus === 'confirm' || uploadStatus === 'done' ? '#34d399' : '#64748b'
  const statusBg    = uploadStatus === 'error' ? '#fef2f2' : uploadStatus === 'confirm' || uploadStatus === 'done' ? '#f0fdf4' : '#f8fafc'
  const statusBorder = uploadStatus === 'error' ? '#fecaca' : '#bbf7d0'

  return (
    <div className="min-h-screen bg-slate-100" style={{ direction: 'rtl' }}>

      {/* כותרת */}
      <div className="bg-white px-8 py-5 flex items-center gap-4 shadow-sm border-b border-slate-200 flex-wrap">
        <Button variant="outline" size="lg" onClick={onBack} className="rounded-xl gap-2.5 px-6 text-[15px] font-bold text-slate-500 hover:text-slate-900">
          <ArrowRight size={22} />
          חזרה
        </Button>
        <div style={{ width: '40px', height: '40px', background: branchColor + '20', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LaborIcon size={20} color={branchColor} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800', color: '#0f172a' }}>לייבור — {branchName}</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>העלאת CashOnTab · הזנה ידנית · עלות מעסיק ×1.3</p>
        </div>
        <div style={{ marginRight: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <PeriodPicker period={period} onChange={setPeriod} />
          <div style={{ background: kpiOk ? '#f0fdf4' : '#fef2f2', border: `1px solid ${kpiOk ? '#bbf7d0' : '#fecaca'}`, borderRadius: '10px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {kpiOk ? <CheckCircle size={16} color="#34d399" /> : <AlertTriangle size={16} color="#fb7185" />}
            <div>
              <div style={{ fontSize: '15px', fontWeight: '800', color: kpiOk ? '#34d399' : '#fb7185' }}>{laborPct.toFixed(1)}%</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>לייבור/הכנסות · יעד {laborTargetPct}%</div>
            </div>
          </div>
          <div style={{ background: branchColor + '15', border: `1px solid ${branchColor}33`, borderRadius: '10px', padding: '8px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: '800', color: branchColor }}>₪{Math.round(totalEmployer).toLocaleString()}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>עלות מעסיק</div>
          </div>
        </div>
      </div>

      {/* טאבים */}
      <div className="flex px-8 bg-white border-b border-slate-200">
        {(['upload','manual','history','daily_report'] as const).map(key => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-3.5 bg-transparent border-0 border-b-[3px] cursor-pointer text-sm transition-colors ${
              tab === key
                ? 'font-bold border-current'
                : 'font-medium border-transparent text-slate-500 hover:text-slate-700'
            }`}
            style={{ color: tab === key ? branchColor : undefined }}>
            {key === 'upload' ? 'העלאת CashOnTab' : key === 'manual' ? 'הזנה ידנית' : key === 'history' ? 'היסטוריה' : 'דוח יומי'}
          </button>
        ))}
      </div>

      <div className="page-container" style={{ padding: '24px 32px', maxWidth: '1000px', margin: '0 auto' }}>

        {/* ══ העלאת PDF ════════════════════════════════════════════════════ */}
        {tab === 'upload' && (
          <>
            <Card className="shadow-sm mb-5">
              <CardContent className="p-6">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#374151' }}>העלאת דוח שעות CashOnTab</h2>
                  <div style={{ position: 'relative' }}>
                    <button onClick={() => setHelpOpen(p => !p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}>
                      <HelpCircle size={18} color={branchColor} />
                    </button>
                    {helpOpen && (
                      <>
                        <div onClick={() => setHelpOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', width: '340px', background: 'white', borderRadius: '12px', boxShadow: '0 10px 40px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0', padding: '16px', zIndex: 50, direction: 'rtl' }}>
                          <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a', marginBottom: '12px' }}>איך להוריד דוח נוכחות מ-CashOnTab?</div>
                          {[
                            'היכנס למערכת CashOnTab → לחץ "עובדים" בתפריט הימני',
                            'בתפריט העליון לחץ על "דו״ח נוכחות"',
                            'סוג דו״ח: בחר "מפורט 1" (לא מרוכז)',
                            'הצג כל עובד בדף נפרד: "כן"',
                            'להציג חלוקה לשעות נוספות: "כן"',
                            'בחר סניפים: סמן את הסניף הרלוונטי',
                            'הגדר תאריך התחלה וסיום (למשל 15-31 לחודש)',
                            'בחר פורמט: PDF → לחץ "הפק דו״ח"',
                            'שמור את הקובץ → חזור לכאן והעלה',
                          ].map((step, i) => (
                            <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', fontSize: '13px', color: '#374151', lineHeight: '1.5' }}>
                              <span style={{ background: branchColor, color: 'white', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', flexShrink: 0, marginTop: '1px' }}>{i + 1}</span>
                              <span>{step}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#94a3b8' }}>PDF דוח נוכחות מפורט מאוטוסופט — פרסור אוטומטי ללא שרת</p>

                <div style={{ marginBottom: '16px' }}>
                  <label style={S.label}>תאריך לשמירה</label>
                  <input type="date" value={uploadDate} onChange={e => setUploadDate(e.target.value)} style={{ ...S.input, width: '180px' }} />
                </div>

                {/* אזור גרירה/העלאה */}
                <label htmlFor="pdf-upload"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
                  style={{ display: 'block', border: `2px dashed ${uploadStatus === 'confirm' ? '#34d399' : '#cbd5e1'}`, borderRadius: '16px', padding: '36px', textAlign: 'center', cursor: 'pointer', background: uploadStatus === 'parsing' ? '#f8fafc' : uploadStatus === 'confirm' ? '#f0fdf4' : 'white', transition: 'all 0.2s' }}>
                  <input id="pdf-upload" type="file" accept=".pdf" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); (e.target as HTMLInputElement).value = '' }} />
                  <FileText size={38} color={uploadStatus === 'confirm' ? '#34d399' : branchColor} style={{ marginBottom: '10px' }} />
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#374151', marginBottom: '4px' }}>
                    {uploadStatus === 'parsing' ? 'מעבד קובץ...' : uploadStatus === 'confirm' ? 'קובץ נקלט בהצלחה' : 'גרור PDF לכאן או לחץ להעלאה'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>דוח נוכחות מפורט מ-CashOnTab</div>
                </label>

                {/* סטטוס */}
                {uploadMsg && (
                  <div style={{ marginTop: '12px', padding: '11px 16px', borderRadius: '10px', background: statusBg, border: `1px solid ${statusBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {(uploadStatus === 'confirm' || uploadStatus === 'done') && <CheckCircle size={16} color="#34d399" />}
                      {uploadStatus === 'error' && <AlertTriangle size={16} color="#fb7185" />}
                      <span style={{ fontSize: '14px', fontWeight: '600', color: statusColor }}>{uploadMsg}</span>
                    </div>
                    {rawLines.length > 0 && (
                      <button onClick={() => setShowRaw(v => !v)}
                        style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '4px 10px', fontSize: '12px', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' as const }}>
                        <Eye size={12} />{showRaw ? 'הסתר' : 'טקסט גולמי'}
                      </button>
                    )}
                  </div>
                )}

                {/* תצוגת טקסט גולמי */}
                {showRaw && rawLines.length > 0 && (
                  <div style={{ marginTop: '10px', background: '#0f172a', borderRadius: '10px', padding: '14px 16px', maxHeight: '220px', overflowY: 'auto' as const }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace', direction: 'ltr' as const }}>
                      {rawLines.map((line, i) => (
                        <div key={i} style={{ padding: '1px 0', color: line.includes('תועש') || line.includes('יפסכ') ? '#34d399' : '#94a3b8' }}>
                          <span style={{ color: '#475569', marginLeft: '8px' }}>{String(i).padStart(2, '0')}</span>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── טבלת אישור ── */}
            {uploadStatus === 'confirm' && parsedRows.length > 0 && (() => {
              const isDetailedMode = parsedRows.some(r => r.total_hours > 0 && r.hourly_rate >= 0)

              // For detailed format: recalculate salary from per-employee hourly rate + bonus
              if (isDetailedMode) {
                for (const r of parsedRows) {
                  const rate = r.hourly_rate || 0
                  if (rate > 0 && r.total_hours > 0) {
                    const c100 = r.hours_100 * rate
                    const c125 = r.hours_125 * rate * 1.25
                    const c150 = r.hours_150 * rate * 1.5
                    const bonusAmount = r.total_hours * (r.retention_bonus || 0)
                    r.cost_100 = c100; r.cost_125 = c125; r.cost_150 = c150
                    r.gross_salary = parseFloat((c100 + c125 + c150 + bonusAmount).toFixed(2))
                    r.employer_cost = parseFloat(((c100 * EMPLOYER_FACTOR) + c125 + c150 + bonusAmount).toFixed(2))
                  }
                }
              }

              return (
              <motion.div variants={fadeIn} initial="hidden" animate="visible">
                <div className="table-scroll">
                  <Card className="shadow-sm">
                    <CardContent className="p-6">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div>
                          <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>
                            אישור לפני שמירה
                          </h3>
                          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                            {isDetailedMode ? 'פורמט מפורט — הזן תעריף שעתי לחישוב שכר' : 'בדוק שהנתונים נכונים — ניתן לבטל עובדים בודדים'}
                          </p>
                        </div>
                        <div style={{ textAlign: 'left' as const, fontSize: '13px' }}>
                          <div style={{ color: '#64748b' }}>ברוטו: <strong style={{ color: branchColor }}>₪{parsedTotal.toLocaleString()}</strong></div>
                          <div style={{ color: '#64748b' }}>עלות מעסיק: <strong style={{ color: '#fb7185' }}>₪{Math.round(parsedEmpTotal).toLocaleString()}</strong></div>
                        </div>
                      </div>

                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isDetailedMode ? '32px 1fr 65px 65px 65px 70px 95px 105px' : '32px 1fr 65px 65px 65px 105px 115px', padding: '9px 14px', background: '#f8fafc', fontSize: '11px', fontWeight: '700', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                          <span />
                          <span>שם עובד</span>
                          <span style={{ textAlign: 'center' }}>100%</span>
                          <span style={{ textAlign: 'center' }}>125%</span>
                          <span style={{ textAlign: 'center' }}>150%</span>
                          {isDetailedMode && <span style={{ textAlign: 'center' }}>₪/שעה</span>}
                          <span>ברוטו</span>
                          <span>עלות מעסיק</span>
                        </div>
                        {parsedRows.map((row, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: isDetailedMode ? '32px 1fr 65px 65px 65px 70px 95px 105px' : '32px 1fr 65px 65px 65px 105px 115px', alignItems: 'center', padding: '11px 14px', borderBottom: i < parsedRows.length - 1 ? '1px solid #f1f5f9' : 'none', background: row.selected ? (i % 2 === 0 ? 'white' : '#fafafa') : '#f8fafc', opacity: row.selected ? 1 : 0.4, transition: 'opacity 0.15s' }}>
                            <input type="checkbox" checked={row.selected}
                              onChange={e => setParsedRows(prev => prev.map((r, j) => j === i ? { ...r, selected: e.target.checked } : r))}
                              style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: branchColor }} />
                            <div>
                              <div style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{row.name}</div>
                              <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                                {row.date ? new Date(row.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' · ' : ''}
                                {row.total_hours} שעות
                              </div>
                            </div>
                            <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_100 > 0 ? row.hours_100 : '—'}</span>
                            <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_125 > 0 ? row.hours_125 : '—'}</span>
                            <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{row.hours_150 > 0 ? row.hours_150 : '—'}</span>
                            {isDetailedMode && (
                              <input type="number" value={row.hourly_rate || ''}
                                onChange={e => {
                                  const newRate = parseFloat(e.target.value) || 0
                                  // Apply rate to ALL rows of the same employee
                                  setParsedRows(prev => prev.map(r => r.name === row.name ? { ...r, hourly_rate: newRate, gross_salary: 0, employer_cost: 0 } : r))
                                }}
                                placeholder="₪"
                                style={{ width: '60px', border: `1.5px solid ${row.hourly_rate > 0 ? '#e2e8f0' : '#fca5a5'}`, borderRadius: '6px', padding: '4px 6px', fontSize: '13px', fontWeight: '700', textAlign: 'center', background: row.hourly_rate > 0 ? 'white' : '#fef2f2' }} />
                            )}
                            <span style={{ fontWeight: '700', color: branchColor, fontSize: '13px' }}>₪{Math.round(row.gross_salary).toLocaleString()}</span>
                            <span style={{ fontWeight: '700', color: '#fb7185', fontSize: '13px' }}>₪{Math.round(row.employer_cost).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <Button variant="ghost" onClick={() => { setParsedRows([]); setUploadStatus('idle'); setUploadMsg('') }}
                          className="rounded-xl px-5 text-sm font-semibold text-slate-500">
                          ביטול
                        </Button>
                        <button onClick={saveSelected} disabled={loading || parsedRows.filter(r => r.selected).length === 0 || (isDetailedMode && parsedRows.some(r => r.selected && r.hourly_rate <= 0))}
                          style={{ background: (loading || (isDetailedMode && parsedRows.some(r => r.selected && r.hourly_rate <= 0))) ? '#e2e8f0' : '#34d399', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <CheckCircle size={16} />שמור {parsedRows.filter(r => r.selected).length} עובדים
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </motion.div>
              ) })()}

            {uploadStatus === 'done' && (
              <Card className="shadow-sm">
                <CardContent className="p-10 text-center">
                  <CheckCircle size={44} color="#34d399" style={{ marginBottom: '10px' }} />
                  <h3 style={{ margin: '0 0 8px', color: '#0f172a' }}>{uploadMsg}</h3>
                  <button onClick={() => { setUploadStatus('idle'); setUploadMsg(''); setTab('history') }}
                    style={{ background: branchColor, color: 'white', border: 'none', borderRadius: '10px', padding: '10px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', marginTop: '10px' }}>
                    ראה היסטוריה
                  </button>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ══ הזנה ידנית ══════════════════════════════════════════════════ */}
        {tab === 'manual' && (
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#374151' }}>הוספת לייבור ידני</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>תאריך</label>
                  <input type="date" value={manDate} onChange={e => setManDate(e.target.value)} style={S.input} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gridColumn: 'span 2' }}>
                  <label style={S.label}>שם עובד</label>
                  <input type="text" placeholder="שם מלא..." value={manName} onChange={e => setManName(e.target.value)} style={S.input} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שעות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="number" placeholder="0" value={manHours} onChange={e => setManHours(e.target.value)} style={{ ...S.input, textAlign: 'right' as const }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>שכר ברוטו (₪)</label>
                  <input type="number" placeholder="0" value={manGross} onChange={e => setManGross(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addManual()}
                    style={{ ...S.input, textAlign: 'right' as const }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                  <label style={S.label}>הערות <span style={{ fontWeight: 400, color: '#94a3b8' }}>(אופ׳)</span></label>
                  <input type="text" placeholder="הערה..." value={manNotes} onChange={e => setManNotes(e.target.value)} style={S.input} />
                </div>
              </div>
              {manGross && parseFloat(manGross) > 0 && (
                <div style={{ background: branchColor + '15', border: `1px solid ${branchColor}33`, borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#64748b' }}>עלות מעסיק (×1.3):</span>
                  <span style={{ fontSize: '18px', fontWeight: '800', color: branchColor }}>₪{Math.round(parseFloat(manGross) * EMPLOYER_FACTOR).toLocaleString()}</span>
                </div>
              )}
              <button onClick={addManual} disabled={loading || !manName || !manGross}
                style={{ background: loading || !manName || !manGross ? '#e2e8f0' : branchColor, color: loading || !manName || !manGross ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', padding: '10px 28px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={18} />הוסף
              </button>
            </CardContent>
          </Card>
        )}

        {/* ══ היסטוריה ════════════════════════════════════════════════════ */}
        {tab === 'history' && (
          <>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '14px', alignItems: 'center' }}>
              <div style={{ marginRight: 'auto', display: 'flex', gap: '16px', fontSize: '13px', color: '#64748b' }}>
                <span>ברוטו: <strong style={{ color: branchColor }}>₪{Math.round(totalGross).toLocaleString()}</strong></span>
                <span>עלות מעסיק: <strong style={{ color: '#fb7185' }}>₪{Math.round(totalEmployer).toLocaleString()}</strong></span>
                <span>שעות: <strong>{totalHours.toFixed(1)}</strong></span>
              </div>
            </div>
            <motion.div variants={fadeIn} initial="hidden" animate="visible">
              <div className="table-scroll">
                <Card className="shadow-sm">
                  <CardContent className="p-0">
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', padding: '10px 20px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                      <span>תאריך</span><span>עובד</span>
                      <span style={{ textAlign: 'center' }}>שעות</span>
                      <span>ברוטו</span><span>עלות מעסיק</span>
                      <span /><span />
                    </div>
                    {entries.length === 0 ? (
                      <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>אין רשומות לחודש זה</div>
                    ) : entries.map((entry, i) => (
                      <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', alignItems: 'center', padding: '12px 20px', borderBottom: i < entries.length - 1 ? '1px solid #f1f5f9' : 'none', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        {editId === entry.id ? (
                          <>
                            <input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px' }} />
                            <input type="text" value={editData.employee_name || ''} onChange={e => setEditData({ ...editData, employee_name: e.target.value })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '13px', fontFamily: 'inherit' }} />
                            <input type="number" value={editData.hours || ''} onChange={e => setEditData({ ...editData, hours: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 6px', fontSize: '12px', textAlign: 'center' as const }} />
                            <input type="number" value={editData.gross_salary || ''} onChange={e => setEditData({ ...editData, gross_salary: parseFloat(e.target.value) })} style={{ border: '1px solid ' + branchColor, borderRadius: '6px', padding: '4px 8px', fontSize: '12px' }} />
                            <span style={{ fontSize: '13px', color: '#fb7185', fontWeight: '700' }}>₪{Math.round(Number(editData.gross_salary || 0) * EMPLOYER_FACTOR).toLocaleString()}</span>
                            <button onClick={() => saveEdit(entry.id)} style={{ background: '#34d399', color: 'white', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✓</button>
                            <button onClick={() => setEditId(null)} style={{ background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: '13px', color: '#64748b' }}>{new Date(entry.date + 'T12:00:00').toLocaleDateString('he-IL')}</span>
                            <div>
                              <span style={{ fontWeight: '600', color: '#374151', fontSize: '14px' }}>{entry.employee_name}</span>
                              {entry.notes && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{entry.notes}</div>}
                            </div>
                            <span style={{ textAlign: 'center', fontSize: '13px', color: '#64748b' }}>{Number(entry.hours) > 0 ? Number(entry.hours).toFixed(1) : '—'}</span>
                            <span style={{ fontWeight: '700', color: branchColor, fontSize: '14px' }}>₪{Number(entry.gross_salary).toLocaleString()}</span>
                            <span style={{ fontWeight: '700', color: '#fb7185', fontSize: '14px' }}>₪{Math.round(Number(entry.employer_cost)).toLocaleString()}</span>
                            <button onClick={() => { setEditId(entry.id); setEditData(entry) }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Pencil size={14} color="#94a3b8" /></button>
                            <button onClick={() => deleteEntry(entry.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}><Trash2 size={14} color="#fb7185" /></button>
                          </>
                        )}
                      </div>
                    ))}
                    {entries.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 70px 110px 120px 36px 36px', padding: '13px 20px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 20px 20px', fontWeight: '700' }}>
                        <span style={{ color: '#374151', fontSize: '13px' }}>סה"כ</span>
                        <span style={{ color: '#64748b', fontSize: '13px' }}>{entries.length} רשומות</span>
                        <span style={{ textAlign: 'center', color: '#64748b', fontSize: '13px' }}>{totalHours.toFixed(1)}</span>
                        <span style={{ color: branchColor }}>₪{Math.round(totalGross).toLocaleString()}</span>
                        <span style={{ color: '#fb7185' }}>₪{Math.round(totalEmployer).toLocaleString()}</span>
                        <span /><span />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          </>
        )}

        {/* ══ דוח יומי ════════════════════════════════════════════════════ */}
        {tab === 'daily_report' && (
          <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }} initial="hidden" animate="visible">
            {dailyLoading ? (
              <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>טוען...</div>
            ) : dailyData.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>אין נתוני לייבור לתקופה</div>
            ) : (
              <>
                {/* Summary cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                  {[
                    { label: 'עלות גולמית', value: dailyData.reduce((s, d) => s + d.gross, 0), color: branchColor },
                    { label: 'עלות מעסיק', value: dailyData.reduce((s, d) => s + d.employer, 0), color: '#fb7185' },
                    { label: 'ממוצע יומי (מעסיק)', value: dailyData.reduce((s, d) => s + d.employer, 0) / dailyData.length, color: '#818cf8' },
                  ].map(c => (
                    <Card key={c.label} className="shadow-sm">
                      <CardContent className="p-4 text-center">
                        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>{c.label}</div>
                        <div style={{ fontSize: '20px', fontWeight: '800', color: c.color }}>₪{Math.round(c.value).toLocaleString()}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Daily table */}
                <Card className="shadow-sm mb-4">
                  <CardContent className="p-0">
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 60px 70px 70px 70px 100px 110px', padding: '10px 16px', background: '#f8fafc', borderRadius: '10px 10px 0 0', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '700', color: '#64748b' }}>
                      <span>תאריך</span><span style={{ textAlign: 'center' }}>עובדים</span>
                      <span style={{ textAlign: 'center' }}>100%</span><span style={{ textAlign: 'center' }}>125%</span><span style={{ textAlign: 'center' }}>150%</span>
                      <span style={{ textAlign: 'left' }}>גולמי</span><span style={{ textAlign: 'left' }}>מעסיק</span>
                    </div>
                    {dailyData.map((d, i) => (
                      <div key={d.date} style={{ display: 'grid', gridTemplateColumns: '100px 60px 70px 70px 70px 100px 110px', padding: '10px 16px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', alignItems: 'center', fontSize: '13px' }}>
                        <span style={{ color: '#374151', fontWeight: '600' }}>{new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}</span>
                        <span style={{ textAlign: 'center', color: '#64748b' }}>{d.employees}</span>
                        <span style={{ textAlign: 'center', color: '#64748b' }}>{d.hours100 > 0 ? d.hours100.toFixed(1) : '—'}</span>
                        <span style={{ textAlign: 'center', color: '#64748b' }}>{d.hours125 > 0 ? d.hours125.toFixed(1) : '—'}</span>
                        <span style={{ textAlign: 'center', color: '#64748b' }}>{d.hours150 > 0 ? d.hours150.toFixed(1) : '—'}</span>
                        <span style={{ fontWeight: '700', color: branchColor }}>₪{Math.round(d.gross).toLocaleString()}</span>
                        <span style={{ fontWeight: '700', color: '#fb7185' }}>₪{Math.round(d.employer).toLocaleString()}</span>
                      </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: '100px 60px 70px 70px 70px 100px 110px', padding: '12px 16px', background: branchColor + '15', borderTop: `2px solid ${branchColor}33`, borderRadius: '0 0 10px 10px', fontWeight: '700', fontSize: '13px' }}>
                      <span style={{ color: '#374151' }}>סה"כ</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{dailyData.reduce((s, d) => s + d.employees, 0)}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{dailyData.reduce((s, d) => s + d.hours100, 0).toFixed(1)}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{dailyData.reduce((s, d) => s + d.hours125, 0).toFixed(1)}</span>
                      <span style={{ textAlign: 'center', color: '#64748b' }}>{dailyData.reduce((s, d) => s + d.hours150, 0).toFixed(1)}</span>
                      <span style={{ color: branchColor }}>₪{Math.round(dailyData.reduce((s, d) => s + d.gross, 0)).toLocaleString()}</span>
                      <span style={{ color: '#fb7185' }}>₪{Math.round(dailyData.reduce((s, d) => s + d.employer, 0)).toLocaleString()}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Chart */}
                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: '700', color: '#374151' }}>עלות יומית</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={dailyData.map(d => ({
                        name: new Date(d.date + 'T12:00:00').toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
                        'עלות גולמית': Math.round(d.gross),
                        'עלות מעסיק': Math.round(d.employer),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `₪${(v / 1000).toFixed(0)}K`} axisLine={false} tickLine={false} />
                        <RTooltip formatter={(v: number) => [`₪${v.toLocaleString()}`, '']} />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <ReferenceLine y={0} stroke="#e2e8f0" />
                        <Line type="monotone" dataKey="עלות גולמית" stroke={branchColor} strokeWidth={2} dot={{ r: 3, fill: 'white', stroke: branchColor, strokeWidth: 2 }} />
                        <Line type="monotone" dataKey="עלות מעסיק" stroke="#fb7185" strokeWidth={2} dot={{ r: 3, fill: 'white', stroke: '#fb7185', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            )}
          </motion.div>
        )}

      </div>
    </div>
  )
}
