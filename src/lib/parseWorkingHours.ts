/**
 * parseWorkingHoursPDF — חילוץ שורות יומיות מדו"ח נוכחות מפורט של CashOnTab
 *
 * שני פורמטים נתמכים:
 *
 * 1. BLOCK FORMAT (עדיפות ראשונה):
 *    - כל עובד מופיע כבלוק עם "שם עובד:" בכותרת
 *    - שורות נתונים עם תאריכים ושעות כניסה/יציאה
 *    - סיכום עובד בתחתית עם "רגילות | רמח 1 | רמח 2 | חריגות"
 *    - ה"רגילות" הוא כותרת סיכום ולא כותרת נתונים!
 *
 * 2. PER-PAGE FORMAT (פולבק):
 *    - עובד אחד לכל עמוד עם "שם עובד:" וכותרות עמודות
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

// ─── פרסור HH:MM לשעות עשרוניות ──────────────────────────────────────────────
function parseHHMM(text: string): number {
  const m = text.match(/^(\d+):(\d{2})$/)
  if (!m) return 0
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60
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

  // ── Build raw text for debug per page ──
  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a)
    const pageLines: string[] = []
    for (const y of yKeys) {
      const row = groups.get(y)!
      pageLines.push(`[Y=${y}] ${row.map(it => `${it.text}(${it.x})`).join(' | ')}`)
    }
    const rawText = pageLines.join('\n')
    rawPages.push(rawText)
    console.log(`[parseWorkingHours] ── PAGE ${pageIdx + 1} ──\n${rawText}`)
  }

  // ── Detect format: tabular (all employees in one table) vs per-page ──
  // Check if any page has "שם עובד:" as standalone header (per-page format)
  let perPageCount = 0
  let tabularHeaderFound = false

  for (const pageItems of allPages) {
    const groups = groupByY(pageItems)
    for (const [, row] of groups) {
      const lineText = row.map(it => it.text).join(' ')
      if (lineText.includes('שם עובד') && (lineText.includes(':') || row.some(it => it.text.includes('עובד:')))) {
        perPageCount++
      }
      // Check for tabular header: "רגילות" on same row as employee-name-related column
      if (row.some(it => it.text === 'רגילות')) {
        tabularHeaderFound = true
      }
    }
  }

  console.log(`[parseWorkingHours] Format detection: perPageCount=${perPageCount}, tabularHeaderFound=${tabularHeaderFound}, totalPages=${allPages.length}`)

  // Detect block format: "שם עובד:" appears AND "רגילות" is in summary footers (not data headers).
  // Block format has employee name headers with data rows between them and summary sections below.
  // If both "שם עובד:" and "רגילות" are present, prefer block format since "רגילות" is a summary footer.
  const useBlock = perPageCount > 0 && tabularHeaderFound

  if (useBlock) {
    console.log(`[parseWorkingHours] Using BLOCK format (employee blocks with summary footers)`)
    parseBlockFormat(allPages, employees, seenKeys)
  } else if (perPageCount > 0) {
    console.log(`[parseWorkingHours] Using PER-PAGE format (one employee per page with "שם עובד:")`)
    parsePerPageFormat(allPages, employees, seenKeys)
  } else {
    console.log(`[parseWorkingHours] Using PER-PAGE format (fallback)`)
    parsePerPageFormat(allPages, employees, seenKeys)
  }

  // Sort by name, then date
  employees.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))

  console.log(`[parseWorkingHours] Total: ${employees.length} daily rows for ${new Set(employees.map(e => e.name)).size} employees`)
  return { employees, rawPages }
}

// ══════════════════════════════════════════════════════════════════════════════
// BLOCK FORMAT: Employee blocks with "שם עובד:" headers, data rows, and
// summary footers containing "רגילות". The "רגילות" line is in the SUMMARY
// section (below data rows), NOT a data column header.
// ══════════════════════════════════════════════════════════════════════════════
function parseBlockFormat(
  allPages: PdfItem[][],
  employees: ParsedEmployee[],
  seenKeys: Set<string>,
) {
  // Process page by page, tracking current employee name across pages
  let currentName = ''
  let dataRowCount = 0
  const debugRows: string[] = []

  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a) // top to bottom (high Y = top of page)

    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      // ── Check for employee name ("שם עובד:" line) ──
      const nameItem = row.find(it => it.text.includes('שם עובד') || it.text.includes('עובד:'))
      if (nameItem) {
        let foundName = ''

        // Try extracting name inline from the item text
        const inlineMatch = nameItem.text.match(/שם\s*עובד[:\s]+(.+)/)
        if (inlineMatch) {
          foundName = inlineMatch[1].trim()
            .replace(/\s+קוד.*/, '').replace(/\s+מחסנים.*/, '')
            .replace(/\s*\d+\s*$/, '').replace(/[0-9:,]/g, '').trim()
        }

        if (!foundName) {
          // Name is in a separate item on the same line — look for Hebrew items
          // that aren't keywords. In RTL PDF, the name is typically to the left of "שם עובד:".
          const skipKeywords = ['קוד', 'שם', 'עובד', 'סניף', 'דו"ח', 'נוכחות',
            'מחסנים', 'מספר', 'המפעל', 'עד', 'תאריך', 'מ-', 'CashOnTab', 'עמוד']
          const candidates = row.filter(it =>
            it !== nameItem &&
            /[\u05D0-\u05EA]/.test(it.text) && it.text.length > 2 &&
            !skipKeywords.some(kw => it.text.includes(kw))
          )
          if (candidates.length > 0) {
            // Pick the candidate that looks most like a person name
            // (closest to nameItem but not a branch/department keyword)
            foundName = candidates[0].text.replace(/[0-9:,]/g, '').trim()
          }
        }

        if (foundName) {
          currentName = foundName.replace(/\s+/g, ' ').trim()
          console.log(`[parseWorkingHours] BLOCK: Page ${pageIdx + 1} found employee "${currentName}"`)
        }
        continue
      }

      // Skip if no current employee
      if (!currentName) continue

      // ── Skip summary/footer/header lines ──
      if (lineText.includes('סיכום לעובד') || lineText.includes('סה"כ ימי')) continue
      if (lineText.includes('רגילות') || lineText.includes('חריגות')) continue
      if (lineText.includes('CashOnTab') || lineText.includes('עמוד')) continue
      if (lineText.includes('סה"כ שעות')) continue
      if (lineText.includes('דו"ח נוכחות')) continue
      if (lineText.includes('עד תאריך') || lineText.includes('מתאריך')) continue

      // ── Check for date → this is a data row ──
      const dateItem = row.find(it => /^\d{2}\/\d{2}\/\d{4}$/.test(it.text))
      if (!dateItem) continue

      dataRowCount++

      const [dd, mm, yyyy] = dateItem.text.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      // ── Extract hours from the row ──
      // Data rows contain HH:MM values for entry time, exit time, and hour totals.
      // Strategy: find all HH:MM items, separate entry/exit times (reasonable work hours)
      // from hour-type totals (smaller values like 06:21, 00:00).
      const timeItems = row.filter(it => /^\d{1,3}:\d{2}$/.test(it.text))

      // Separate into "work times" (entry/exit, typically 5:00-23:59) and
      // "hour values" (totals, typically 0:00-24:00 but representing durations)
      // Work times are at higher X values (right side in LTR coords = left in RTL visual),
      // hour totals are at lower X values.
      const dateX = dateItem.x

      // Items to the LEFT of date (lower X) are typically hour totals
      // Items to the RIGHT of date (higher X) or near it are entry/exit times
      // But in RTL PDFs, the date column is on the right side, so items with X < dateX are hour totals
      const hourTotalItems = timeItems.filter(it => it.x < dateX - 30)
      const workTimeItems = timeItems.filter(it => it.x >= dateX - 30 && it !== dateItem)

      let totalH = 0

      // Try to get total from the hour total columns
      // The rightmost hour-total item (closest to date) is likely the "total hours" column
      if (hourTotalItems.length > 0) {
        // Sort by X descending — rightmost first (closest to date column)
        const sorted = [...hourTotalItems].sort((a, b) => b.x - a.x)
        const totalCandidate = parseHHMM(sorted[0].text)
        if (totalCandidate > 0 && totalCandidate < 24) {
          totalH = totalCandidate
        }
      }

      // Fallback: calculate from entry/exit times
      if (totalH <= 0 && workTimeItems.length >= 2) {
        const workHours = workTimeItems
          .map(it => ({ ...it, hours: parseHHMM(it.text) }))
          .filter(it => it.hours >= 5 && it.hours <= 24)
          .sort((a, b) => a.hours - b.hours)

        if (workHours.length >= 2) {
          totalH = workHours[workHours.length - 1].hours - workHours[0].hours
        }
      }

      // Another fallback: just find the largest reasonable HH:MM that looks like a duration
      if (totalH <= 0) {
        const allHours = timeItems.map(it => parseHHMM(it.text)).filter(h => h > 0 && h < 24)
        // Exclude values that look like clock times (>= 5 hours as absolute time)
        // Duration totals for a day should be < 16 hours
        const durations = allHours.filter(h => h < 16)
        if (durations.length > 0) {
          totalH = Math.max(...durations)
        }
      }

      if (totalH <= 0) continue

      const key = `${currentName}|${dateStr}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      employees.push({
        name: currentName,
        date: dateStr,
        total_hours: Math.round(totalH * 100) / 100,
        hours_100: Math.round(totalH * 100) / 100, // Daily breakdown not available in block format
        hours_125: 0,
        hours_150: 0,
      })

      // Debug: log first 5 data rows
      if (debugRows.length < 5) {
        debugRows.push(
          `  Row ${dataRowCount}: employee="${currentName}", date=${dateStr}, total=${totalH}, items=${row.map(it => `${it.text}(${it.x})`).join(' | ')}`
        )
      }
    }
  }

  console.log(`[parseWorkingHours] BLOCK: Processed ${dataRowCount} data rows`)
  if (debugRows.length > 0) {
    console.log(`[parseWorkingHours] BLOCK: First ${debugRows.length} parsed rows:\n${debugRows.join('\n')}`)
  }
  console.log(`[parseWorkingHours] BLOCK: Resulted in ${employees.length} employee-day records for ${new Set(employees.map(e => e.name)).size} unique employees`)
}

// ══════════════════════════════════════════════════════════════════════════════
// PER-PAGE FORMAT: One employee per page with "שם עובד:" header (FALLBACK)
// ══════════════════════════════════════════════════════════════════════════════
function parsePerPageFormat(
  allPages: PdfItem[][],
  employees: ParsedEmployee[],
  seenKeys: Set<string>,
) {
  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a)

    // ── Step 1: Find employee name ──
    let name = ''
    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineTextLTR = row.map(it => it.text).join(' ')
      const lineTextRTL = [...row].sort((a, b) => b.x - a.x).map(it => it.text).join(' ')

      const nameItem = row.find(it => it.text.includes('שם עובד') || it.text.includes('עובד:'))
      if (nameItem) {
        const inlineMatch = nameItem.text.match(/שם\s*עובד[:\s]+(.+)/)
        if (inlineMatch) {
          name = inlineMatch[1].trim().replace(/\s+קוד.*/, '').replace(/\s+מחסנים.*/, '').replace(/\s*\d+\s*$/, '').trim()
        }
        if (!name) {
          const candidates = row.filter(it =>
            it !== nameItem &&
            /[\u05D0-\u05EA]/.test(it.text) &&
            !it.text.includes('קוד') && !it.text.includes('מחסנים') &&
            !it.text.includes('סניף') && !it.text.includes('שם עובד') &&
            !it.text.includes('מספר') && !it.text.includes('דו"ח') &&
            !it.text.includes('נוכחות') && !it.text.includes('המפעל')
          )
          if (candidates.length) {
            name = candidates.sort((a, b) => b.x - a.x).map(it => it.text).join(' ')
          }
        }
        if (name) break
      }

      for (const txt of [lineTextLTR, lineTextRTL]) {
        const m = txt.match(/שם\s*עובד[:\s]+(.+?)(?:\s+קוד|\s+מספר|\s*$)/)
        if (m && !name) {
          name = m[1].trim().replace(/\s+/g, ' ').replace(/\s*\d+\s*$/, '').trim()
          break
        }
      }
      if (name) break
    }

    if (!name) {
      console.warn(`[parseWorkingHours] PER-PAGE: Page ${pageIdx + 1}: no employee name found`)
      continue
    }
    name = name.replace(/[0-9:,]/g, '').replace(/\s+/g, ' ').trim()
    console.log(`[parseWorkingHours] PER-PAGE: Page ${pageIdx + 1}: found employee "${name}"`)

    // ── Step 2: Find column headers ──
    const columnXs = new Map<string, number>()
    let headerBottomY = -Infinity

    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')
      if (lineText.includes('סיכום') || lineText.includes('כדר"מ')) continue

      const hasRegular = row.some(it => it.text === 'רגילות')
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
      console.warn(`[parseWorkingHours] PER-PAGE: Page ${pageIdx + 1}: no "רגילות" header found for ${name}`)
      continue
    }

    // Find "רמה" items near header
    for (const y of yKeys) {
      if (Math.abs(y - headerBottomY) > 8) continue
      const row = groups.get(y)!
      for (let i = 0; i < row.length; i++) {
        const item = row[i]
        if (item.text === 'רמה 1' || item.text === '1 רמה' || item.text === '1 רמח' || item.text === 'רמח 1') columnXs.set('level1', item.x)
        if (item.text === 'רמה 2' || item.text === '2 רמה' || item.text === '2 רמח' || item.text === 'רמח 2') columnXs.set('level2', item.x)
        if ((item.text === 'רמה' || item.text === 'רמח') && i + 1 < row.length) {
          const next = row[i + 1].text
          if (next === '1') columnXs.set('level1', item.x)
          else if (next === '2') columnXs.set('level2', item.x)
        }
      }
    }

    // Find "סה"כ שעות" total column
    for (const y of yKeys) {
      if (y <= headerBottomY || y > headerBottomY + 30) continue
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')
      if (!lineText.includes('סה"כ') && !lineText.includes('שעות')) continue

      for (const item of row) {
        if (item.text.includes('סה"כ')) {
          const regularX = columnXs.get('regular')!
          const isNearKnown = ['regular', 'level1', 'level2', 'exceptions']
            .map(k => columnXs.get(k))
            .filter(x => x !== undefined)
            .some(x => Math.abs(item.x - x!) < 30)
          if (!isNearKnown && !columnXs.has('total_hours')) {
            columnXs.set('total_hours', item.x)
          }
        }
      }
      if (columnXs.has('total_hours')) break
    }

    if (!columnXs.has('total_hours')) {
      const regX = columnXs.get('regular')!
      columnXs.set('total_hours', regX + 50)
    }

    console.log(`[parseWorkingHours] PER-PAGE: Page ${pageIdx + 1} ${name} — columns:`, Object.fromEntries(columnXs))

    // ── Step 3: Extract daily rows ──
    for (const y of yKeys) {
      if (y >= headerBottomY) continue

      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      if (lineText.includes('סיכום') || lineText.includes('CashOnTab') || lineText.includes('עמוד')
        || lineText.includes('סה"כ ימי') || lineText.includes('סה"כ שעות')) continue

      const dateItem = row.find(it => /^\d{2}\/\d{2}\/\d{4}$/.test(it.text))
      if (!dateItem) continue

      const [dd, mm, yyyy] = dateItem.text.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      const cellMap = new Map<string, number>()

      for (const item of row) {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(item.text)) continue
        if (/[\u05D0-\u05EA]/.test(item.text)) continue

        // Try HH:MM
        const hhmmVal = parseHHMM(item.text)
        if (hhmmVal > 0) {
          const col = findClosestColumn(item.x, columnXs)
          if (col && !['register', 'branch', 'date', 'report_type'].includes(col)) {
            cellMap.set(col, hhmmVal)
          }
          continue
        }

        const val = parseFloat(item.text.replace(/,/g, ''))
        if (isNaN(val)) continue

        const col = findClosestColumn(item.x, columnXs)
        if (col && !['register', 'branch', 'date', 'report_type'].includes(col)) {
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
        total_hours: Math.round(totalH * 100) / 100,
        hours_100: Math.round(h100 * 100) / 100,
        hours_125: Math.round(h125 * 100) / 100,
        hours_150: Math.round(h150 * 100) / 100,
      })
    }
  }

  console.log(`[parseWorkingHours] PER-PAGE: Found ${employees.length} rows for ${new Set(employees.map(e => e.name)).size} employees`)
}
