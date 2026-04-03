/**
 * parseWorkingHoursPDF — חילוץ שורות יומיות מדו"ח נוכחות מפורט של CashOnTab
 *
 * אסטרטגיה: שימוש בעמודות X של שורת הכותרת (header) כדי למפות כל תא לעמודה הנכונה.
 *
 * הכותרת ב-PDF היא דו-שורתית:
 *   שורה עליונה: סה"כ שעות | סה"כ שעות | סה"כ שעות | סה"כ שעות | סניף | קופה | סוג | ...
 *   שורה תחתונה: חריגות | רמה 2 | רמה 1 | רגילות | (ריקה) | (ריקה) | דיווח | ...
 *
 * "רגילות", "רמה 1", "רמה 2", "חריגות" הן תת-כותרות — ה-X שלהן מציין את העמודה.
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
function findClosestColumn(x: number, columnXs: Map<string, number>, maxDist = 35): string | null {
  let best = '', bestDist = Infinity
  for (const [name, cx] of columnXs) {
    const dist = Math.abs(x - cx)
    if (dist < bestDist) { bestDist = dist; best = name }
  }
  return bestDist <= maxDist ? best : null
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
      pageLines.push(`[Y=${y}] ${row.map(it => `${it.text}(${it.x})`).join(' | ')}`)
    }
    const rawText = pageLines.join('\n')
    rawPages.push(rawText)
    console.log(`[parseWorkingHours] ── PAGE ${pageIdx + 1} ──\n${rawText}`)

    // ── שלב 1: מצא שם עובד ──
    // Search through GROUPED lines (sorted by Y) — more reliable than raw fullText
    // because fullText joins items in pdf.js stream order which may not be visual order
    let name = ''
    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      // Try "שם עובד:" on this line
      const m = lineText.match(/שם עובד[:\s]+(.+?)(?:\s+קוד|\s*$)/)
      if (m) {
        name = m[1].trim().replace(/\s+/g, ' ')
        // Remove trailing numbers/codes
        name = name.replace(/\s*\d+\s*$/, '').trim()
        break
      }

      // Also try: find item containing "שם עובד" and take the next Hebrew items
      const idx = row.findIndex(it => it.text.includes('שם עובד'))
      if (idx >= 0) {
        const item = row[idx]
        // The name might be INSIDE this item: "שם עובד: אסף דוד"
        const inlineMatch = item.text.match(/שם עובד[:\s]+(.+)/)
        if (inlineMatch) {
          name = inlineMatch[1].trim().replace(/\s+קוד.*/, '').replace(/\s+מחסנים.*/, '').trim()
        }
        // Or the name might be in adjacent items (sorted by X)
        if (!name) {
          const hebItems = row.slice(idx + 1).filter(it => /[\u05D0-\u05EA]/.test(it.text) && !it.text.includes('קוד') && !it.text.includes('מחסנים'))
          if (hebItems.length) name = hebItems.map(it => it.text).join(' ')
        }
        if (name) break
      }
    }

    if (!name) {
      console.warn(`[parseWorkingHours] Page ${pageIdx + 1}: no employee name found`)
      continue
    }
    console.log(`[parseWorkingHours] Page ${pageIdx + 1}: found employee "${name}"`)

    // ── שלב 2: מצא עמודות מתוך כל שורות הכותרת ──
    // The header is 2 rows. We look for specific sub-header keywords
    // across ALL lines in the top portion of the page (above data rows).
    // Keywords: "רגילות", "רמה 1"/"רמה", "חריגות", "קופה", "סניף", "תאריך"
    const columnXs = new Map<string, number>()
    let headerBottomY = -Infinity

    // First pass: find the TABLE HEADER line with "רגילות"
    // yKeys is sorted descending (highest Y = top of page first)
    // We want the FIRST (topmost) occurrence — that's the table header, not the summary
    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      // Skip lines that are part of summary section
      if (lineText.includes('סיכום') || lineText.includes('כדר"מ')) continue

      const hasRegular = row.some(it => it.text === 'רגילות')
      const hasRama = row.some(it => it.text.includes('רמה'))

      if (hasRegular && hasRama) {
        // This is the sub-header row with "רגילות | רמה 1 | רמה 2 | חריגות"
        for (const item of row) {
          if (item.text === 'רגילות') columnXs.set('regular', item.x)
          if (item.text === 'חריגות') columnXs.set('exceptions', item.x)
        }
        headerBottomY = y
        break // Take the FIRST (topmost) match
      }

      // Also check for "רגילות" alone (might be on its own line)
      if (hasRegular) {
        for (const item of row) {
          if (item.text === 'רגילות') columnXs.set('regular', item.x)
          if (item.text === 'חריגות') columnXs.set('exceptions', item.x)
        }
        headerBottomY = y
        break
      }
    }

    if (!columnXs.has('regular')) {
      console.warn(`[parseWorkingHours] Page ${pageIdx + 1}: no "רגילות" header found for ${name}`)
      continue
    }

    // Find "רמה" items on the same header line(s)
    for (const y of yKeys) {
      if (Math.abs(y - headerBottomY) > 8) continue // Only look near the sub-header line
      const row = groups.get(y)!
      for (let i = 0; i < row.length; i++) {
        const item = row[i]
        // "רמה 1" or "רמה" followed by "1"
        if (item.text === 'רמה 1' || item.text === '1 רמה') columnXs.set('level1', item.x)
        if (item.text === 'רמה 2' || item.text === '2 רמה') columnXs.set('level2', item.x)
        if (item.text === 'רמה' && i + 1 < row.length) {
          const next = row[i + 1].text
          if (next === '1') columnXs.set('level1', item.x)
          else if (next === '2') columnXs.set('level2', item.x)
        }
      }
    }

    // Find "סה"כ שעות" on the header line above — this is the "total hours" column
    // It's the "סה"כ שעות" that's directly above the data area (closest X to "רגילות" but slightly different)
    // Actually, "סה"כ שעות" appears multiple times. The one for total hours has a unique X.
    // Strategy: look at the header row ABOVE the sub-header, find the "סה"כ" or "סה"כ שעות"
    // that is to the RIGHT of "רגילות" (higher X in the data = to the left visually in RTL,
    // but in PDF coords, higher X = more right)

    // Find the line with "סה"כ שעות" closest to (but above) the sub-header
    for (const y of yKeys) {
      if (y <= headerBottomY) continue // Must be above sub-header
      if (y > headerBottomY + 30) continue // Not too far above
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')
      if (!lineText.includes('סה"כ') && !lineText.includes('שעות')) continue

      // Find all "סה"כ שעות" or "סה"כ" items
      // The leftmost (lowest X) "סה"כ שעות" that isn't near רגילות/רמה1/רמה2 = the total column
      for (const item of row) {
        if (item.text.includes('סה"כ')) {
          // Check if this X is NOT close to regular/level1/level2 (those have their own "סה"כ שעות" above them)
          const regularX = columnXs.get('regular')!
          const level1X = columnXs.get('level1')
          const level2X = columnXs.get('level2')
          const exceptX = columnXs.get('exceptions')

          const isNearKnown = [regularX, level1X, level2X, exceptX]
            .filter(x => x !== undefined)
            .some(x => Math.abs(item.x - x!) < 30)

          if (!isNearKnown) {
            // This "סה"כ שעות" is the total hours column
            if (!columnXs.has('total_hours')) {
              columnXs.set('total_hours', item.x)
            }
          }
        }
      }
      if (columnXs.has('total_hours')) break
    }

    // Also look for "קופה", "סניף", "תאריך" etc. on header lines
    for (const y of yKeys) {
      if (y < headerBottomY) continue
      if (y > headerBottomY + 30) continue
      const row = groups.get(y)!
      for (const item of row) {
        if (item.text === 'קופה') columnXs.set('register', item.x)
        if (item.text === 'סניף') columnXs.set('branch', item.x)
        if (item.text === 'תאריך') columnXs.set('date', item.x)
        if (item.text === 'סוג' || item.text.includes('דיווח')) columnXs.set('report_type', item.x)
      }
    }

    console.log(`[parseWorkingHours] Page ${pageIdx + 1} ${name} — columns:`,
      Object.fromEntries(columnXs))

    if (!columnXs.has('total_hours')) {
      console.warn(`[parseWorkingHours] Page ${pageIdx + 1}: no "סה"כ שעות" column found for ${name}`)
      // Fallback: the total_hours column is usually to the right of "regular" in X coords
      // (In the PDF visual layout, total hours is to the LEFT of regular)
      // So we estimate it
      const regX = columnXs.get('regular')!
      // In the data rows, total_hours should be at higher X than regular (further right in PDF coords)
      // We'll use a column that's about 50px to the right of regular
      columnXs.set('total_hours', regX + 50)
      console.log(`[parseWorkingHours] Estimated total_hours X = ${regX + 50}`)
    }

    // ── שלב 3: חלץ שורות יומיות ──
    // Lines BELOW the header that contain a date DD/MM/YYYY
    for (const y of yKeys) {
      if (y >= headerBottomY) continue // skip header and above

      const row = groups.get(y)!
      const texts = row.map(it => it.text)
      const lineText = texts.join(' ')

      // Skip summary/footer lines
      if (lineText.includes('סיכום') || lineText.includes('CashOnTab') || lineText.includes('עמוד')
        || lineText.includes('סה"כ ימי') || lineText.includes('סה"כ שעות')) continue

      // Look for date DD/MM/YYYY
      const dateItem = row.find(it => /^\d{2}\/\d{2}\/\d{4}$/.test(it.text))
      if (!dateItem) continue

      // Parse date
      const [dd, mm, yyyy] = dateItem.text.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      // Map each number to its closest column
      const cellMap = new Map<string, number>()

      for (const item of row) {
        // Skip dates, times, Hebrew text
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(item.text)) continue
        if (/^\d{2}:\d{2}$/.test(item.text)) continue
        if (/[\u05D0-\u05EA]/.test(item.text)) continue

        const val = parseFloat(item.text.replace(/,/g, ''))
        if (isNaN(val)) continue

        const col = findClosestColumn(item.x, columnXs)
        if (col && col !== 'register' && col !== 'branch' && col !== 'report_type' && col !== 'date') {
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
