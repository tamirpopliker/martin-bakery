/**
 * parseWorkingHoursPDF — חילוץ שורות יומיות מדו"ח נוכחות מפורט של CashOnTab
 *
 * אסטרטגיה: שימוש בעמודות X של שורת הכותרת (header) כדי למפות כל תא לעמודה הנכונה.
 * כותרות ידועות: תאריך | יום | כניסה | יציאה | סוג דיווח | קופה | סניף | סה"כ שעות | רגילות | רמה 1 | רמה 2 | חריגות
 *
 * כל עובד מזוהה לפי "שם עובד:" בראש הדף.
 * שורות יומיות מזוהות לפי תאריך DD/MM/YYYY.
 * התוצאה: שורה אחת לכל יום לכל עובד.
 */

export interface ParsedEmployee {
  name: string
  date: string          // YYYY-MM-DD
  total_hours: number
  hours_100: number     // רגילות
  hours_125: number     // רמה 1
  hours_150: number     // רמה 2
}

interface PdfItem { text: string; x: number; y: number }

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

// ─── חילוץ items עם x,y מכל דף ─────────────────────────────────────────────
async function extractItemsPerPage(file: File): Promise<PdfItem[][]> {
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
        items.push({
          text: item.str.trim(),
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        })
      }
    }
    pages.push(items)
  }
  return pages
}

// ─── קיבוץ items לשורות לפי Y ────────────────────────────────────────────────
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
  for (const [, row] of groups) row.sort((a, b) => a.x - b.x)
  return groups
}

// ─── מציאת עמודה הכי קרובה ────────────────────────────────────────────────────
function findClosestColumn(x: number, columnXs: Map<string, number>): string | null {
  let best = '', bestDist = Infinity
  for (const [name, cx] of columnXs) {
    const dist = Math.abs(x - cx)
    if (dist < bestDist) { bestDist = dist; best = name }
  }
  return bestDist < 40 ? best : null
}

// ─── Header column keywords ────────────────────────────────────────────────────
// The PDF header row contains these labels (some may be split across items)
const HEADER_KEYWORDS: Record<string, string[]> = {
  'total_hours': ['סה"כ שעות', 'שעות כ"סה'],
  'regular':     ['רגילות'],
  'level1':      ['רמה 1', '1 רמה', 'רמה'],
  'level2':      ['רמה 2', '2 רמה'],
  'exceptions':  ['חריגות'],
  'register':    ['קופה'],
  'report_type': ['סוג', 'דיווח'],
  'branch':      ['סניף'],
  'date':        ['תאריך'],
}

// ─── פרסור ראשי ─────────────────────────────────────────────────────────────
export async function parseWorkingHoursPDF(file: File): Promise<{
  employees: ParsedEmployee[]
  rawPages: string[]
}> {
  const allPages = await extractItemsPerPage(file)
  const rawPages: string[] = []
  const employees: ParsedEmployee[] = []
  const seenKeys = new Set<string>()

  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a) // high Y = top of page

    // Build raw text for debug
    const pageLines: string[] = []
    for (const y of yKeys) {
      const row = groups.get(y)!
      pageLines.push(row.map(it => it.text).join(' | '))
    }
    const rawText = pageLines.join('\n')
    rawPages.push(rawText)
    console.log(`[parseWorkingHours] ── PAGE ${pageIdx + 1} ──\n${rawText}`)

    // ── שלב 1: מצא שם עובד ──
    const fullText = pageItems.map(it => it.text).join(' ')
    const nameMatch = fullText.match(/שם עובד[:\s]+([^\n]+?)(?:\s+קוד|\s+מחסנים|\s+תאריך)/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim().replace(/\s+/g, ' ')
    if (!name) continue

    // ── שלב 2: מצא שורת header ──
    // Look for the line that contains "סה"כ שעות" AND "רגילות" (or nearby)
    let headerY = -1
    const columnXs = new Map<string, number>()

    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      // Header line should contain multiple column names
      const hasTotal = lineText.includes('סה"כ שעות') || lineText.includes('שעות כ"סה')
      const hasRegular = lineText.includes('רגילות')

      if (hasTotal && hasRegular) {
        headerY = y

        // Map each header label to its X position
        // First, try to find multi-word headers by joining adjacent items
        for (let i = 0; i < row.length; i++) {
          const item = row[i]
          const text = item.text

          // Check single-item matches
          if (text === 'רגילות') columnXs.set('regular', item.x)
          if (text === 'חריגות') columnXs.set('exceptions', item.x)
          if (text === 'קופה') columnXs.set('register', item.x)
          if (text === 'סניף') columnXs.set('branch', item.x)
          if (text === 'תאריך') columnXs.set('date', item.x)

          // Multi-word: "סה"כ שעות" might be one item or two
          if (text.includes('סה"כ שעות') || text.includes('שעות כ"סה')) {
            columnXs.set('total_hours', item.x)
          }
          if (text === 'סה"כ' && i + 1 < row.length && row[i + 1].text === 'שעות') {
            columnXs.set('total_hours', item.x)
          }
          if (text === 'שעות' && i > 0 && row[i - 1].text === 'סה"כ') {
            columnXs.set('total_hours', row[i - 1].x)
          }

          // "רמה 1" / "רמה 2" might be split
          if (text === 'רמה') {
            // Look at next item for the number
            if (i + 1 < row.length) {
              const next = row[i + 1].text
              if (next === '1') columnXs.set('level1', item.x)
              else if (next === '2') columnXs.set('level2', item.x)
            }
          }
          // Or combined
          if (text === 'רמה 1' || text === '1 רמה') columnXs.set('level1', item.x)
          if (text === 'רמה 2' || text === '2 רמה') columnXs.set('level2', item.x)

          // "סוג דיווח" might be split
          if (text.includes('סוג') && text.includes('דיווח')) columnXs.set('report_type', item.x)
          if (text === 'סוג') columnXs.set('report_type', item.x)
        }

        // Also check for "סה"כ שעות" split across "סה"כ שעות\nרגילות"
        // Some PDFs have multi-line headers

        console.log(`[parseWorkingHours] Header found at Y=${headerY}, columns:`, Object.fromEntries(columnXs))
        break
      }
    }

    if (headerY === -1 || !columnXs.has('total_hours')) {
      console.warn(`[parseWorkingHours] No header found on page ${pageIdx + 1} for ${name}`)
      continue
    }

    // ── שלב 3: חלץ שורות יומיות ──
    // Lines BELOW the header (lower Y) that contain a date DD/MM/YYYY
    for (const y of yKeys) {
      if (y >= headerY) continue // skip header and above

      const row = groups.get(y)!
      const texts = row.map(it => it.text)
      const lineText = texts.join(' ')

      // Skip summary lines
      if (lineText.includes('סיכום') || lineText.includes('CashOnTab') || lineText.includes('עמוד')) continue

      // Look for date DD/MM/YYYY
      const dateItem = row.find(it => /^\d{2}\/\d{2}\/\d{4}$/.test(it.text))
      if (!dateItem) continue

      // Parse date
      const [dd, mm, yyyy] = dateItem.text.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      // Skip rows with 0 total hours (non-work days that appear in PDF)
      // Map each number item to its closest column
      const cellMap = new Map<string, number>()

      for (const item of row) {
        // Skip non-numeric items (dates, times, Hebrew text)
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(item.text)) continue
        if (/^\d{2}:\d{2}$/.test(item.text)) continue
        if (/[\u05D0-\u05EA]/.test(item.text)) continue

        const val = parseFloat(item.text.replace(/,/g, ''))
        if (isNaN(val)) continue

        // Find closest column header
        const col = findClosestColumn(item.x, columnXs)
        if (col) {
          cellMap.set(col, val)
        }
      }

      const totalH = cellMap.get('total_hours') || 0
      if (totalH <= 0) continue

      const h100 = cellMap.get('regular') || 0
      const h125 = cellMap.get('level1') || 0
      const h150 = cellMap.get('level2') || 0

      const key = `${name}|${dateStr}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      console.log(`[parseWorkingHours] ${name} ${dateStr}: total=${totalH}, h100=${h100}, h125=${h125}, h150=${h150}`)

      employees.push({
        name,
        date: dateStr,
        total_hours: totalH,
        hours_100: h100,
        hours_125: h125,
        hours_150: h150,
      })
    }
  }

  // Sort by name, then date
  employees.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))

  console.log(`[parseWorkingHours] Total: ${employees.length} daily rows for ${new Set(employees.map(e => e.name)).size} employees`)
  return { employees, rawPages }
}
