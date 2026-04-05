/**
 * parseWorkingHoursPDF — חילוץ שורות יומיות מדו"ח נוכחות מפורט של CashOnTab
 *
 * אסטרטגיה חדשה: ה-PDF הוא טבלה אחת שמתפרשת על פני מספר עמודים.
 * כל העובדים מופיעים בטבלה אחת (לא עובד-לכל-עמוד).
 *
 * שלב 1: איחוד כל הפריטים מכל העמודים לרשימה אחת
 * שלב 2: זיהוי כותרות עמודות מהשורה הראשונה עם "רגילות"
 * שלב 3: זיהוי עמודת "שם" לשמות עובדים
 * שלב 4: סריקת שורות נתונים (שורות עם תאריך DD/MM/YYYY)
 *
 * פולבק: אם נמצא "שם עובד:" כהדר עצמאי — שימוש בפורמט עובד-לכל-עמוד
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

  // If most pages have "שם עובד:", use per-page format.
  // Otherwise use tabular format.
  const useTabular = tabularHeaderFound && perPageCount < allPages.length / 2

  if (useTabular) {
    console.log(`[parseWorkingHours] Using TABULAR format (multi-employee table across pages)`)
    parseTabularFormat(allPages, employees, seenKeys)
  } else {
    console.log(`[parseWorkingHours] Using PER-PAGE format (one employee per page with "שם עובד:")`)
    parsePerPageFormat(allPages, employees, seenKeys)
  }

  // Sort by name, then date
  employees.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))

  console.log(`[parseWorkingHours] Total: ${employees.length} daily rows for ${new Set(employees.map(e => e.name)).size} employees`)
  return { employees, rawPages }
}

// ══════════════════════════════════════════════════════════════════════════════
// TABULAR FORMAT: All employees in one big table spanning multiple pages
// ══════════════════════════════════════════════════════════════════════════════
function parseTabularFormat(
  allPages: PdfItem[][],
  employees: ParsedEmployee[],
  seenKeys: Set<string>,
) {
  // Step 1: Concatenate all items from all pages, offsetting Y so pages don't overlap.
  // We use a large Y offset per page so rows from different pages don't merge.
  const PAGE_Y_OFFSET = 10000
  const allItems: PdfItem[] = []
  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    for (const item of allPages[pageIdx]) {
      allItems.push({
        text: item.text,
        x: item.x,
        y: item.y + pageIdx * PAGE_Y_OFFSET,
      })
    }
  }

  // Step 2: Find header columns from the FIRST occurrence of "רגילות"
  // We scan page by page to find the header row.
  const columnXs = new Map<string, number>()
  let headerY = -1
  let headerPageIdx = -1

  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)

    for (const [y, row] of groups) {
      const hasRegular = row.some(it => it.text === 'רגילות')
      if (!hasRegular) continue

      // Skip summary lines
      const lineText = row.map(it => it.text).join(' ')
      if (lineText.includes('סיכום') || lineText.includes('כדר"מ')) continue

      // Found the header row with "רגילות"
      headerY = y
      headerPageIdx = pageIdx

      for (const item of row) {
        if (item.text === 'רגילות') columnXs.set('regular', item.x)
        if (item.text === 'חריגות') columnXs.set('exceptions', item.x)
        if (item.text === '1 רמח' || item.text === 'רמח 1' || item.text === 'רמה 1' || item.text === '1 רמה') columnXs.set('level1', item.x)
        if (item.text === '2 רמח' || item.text === 'רמח 2' || item.text === 'רמה 2' || item.text === '2 רמה') columnXs.set('level2', item.x)
      }

      // Also look for "רמח" or "רמה" items that are separate from numbers
      for (let i = 0; i < row.length; i++) {
        const item = row[i]
        if (item.text === 'רמח' || item.text === 'רמה') {
          // Look for adjacent number
          for (let j = i - 1; j <= i + 1; j++) {
            if (j >= 0 && j < row.length && j !== i) {
              if (row[j].text === '1') columnXs.set('level1', item.x)
              else if (row[j].text === '2') columnXs.set('level2', item.x)
            }
          }
        }
      }

      break
    }
    if (headerY >= 0) break
  }

  if (headerY < 0) {
    console.warn(`[parseWorkingHours] TABULAR: no header row with "רגילות" found!`)
    return
  }

  // Step 2b: Find additional header columns from adjacent rows (within ~15 Y units)
  // Look for "שם" column, "תאריך", "סניף", etc. in header area
  const headerPage = allPages[headerPageIdx]
  const headerGroups = groupByY(headerPage)
  let nameColumnX = -1

  for (const [y, row] of headerGroups) {
    if (Math.abs(y - headerY) > 20) continue // Only near the header row

    for (const item of row) {
      if (item.text === 'שם' || item.text === 'שם עובד' || item.text === 'עובד') {
        nameColumnX = item.x
        columnXs.set('employee_name', item.x)
      }
      if (item.text === 'תאריך') columnXs.set('date', item.x)
      if (item.text === 'סניף') columnXs.set('branch', item.x)
      if (item.text === 'קופה') columnXs.set('register', item.x)
      if (item.text === 'יציאה') columnXs.set('exit_time', item.x)
      if (item.text === 'כניסה') columnXs.set('entry_time', item.x)
    }

    // Also check for combined header items like "שם עובד"
    const lineText = row.map(it => it.text).join(' ')
    if (lineText.includes('שם') && nameColumnX < 0) {
      const nameItem = row.find(it => it.text.includes('שם'))
      if (nameItem) {
        nameColumnX = nameItem.x
        columnXs.set('employee_name', nameItem.x)
      }
    }
  }

  console.log(`[parseWorkingHours] TABULAR: Header found on page ${headerPageIdx + 1}, Y=${headerY}`)
  console.log(`[parseWorkingHours] TABULAR: Column X positions:`, Object.fromEntries(columnXs))
  console.log(`[parseWorkingHours] TABULAR: Employee name column X=${nameColumnX}`)

  // Step 3: Process data rows from ALL pages
  // A data row is identified by having a date pattern DD/MM/YYYY
  let dataRowCount = 0
  const debugRows: string[] = []

  for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
    const pageItems = allPages[pageIdx]
    const groups = groupByY(pageItems)
    const yKeys = [...groups.keys()].sort((a, b) => b - a) // top to bottom

    for (const y of yKeys) {
      const row = groups.get(y)!
      const lineText = row.map(it => it.text).join(' ')

      // Skip header/footer/summary lines
      if (lineText.includes('סיכום') || lineText.includes('CashOnTab') || lineText.includes('עמוד')
        || lineText.includes('רגילות') || lineText.includes('סה"כ ימי')) continue

      // Find date item (DD/MM/YYYY)
      const dateItem = row.find(it => /^\d{2}\/\d{2}\/\d{4}$/.test(it.text))
      if (!dateItem) continue

      dataRowCount++

      // Parse date
      const [dd, mm, yyyy] = dateItem.text.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      // Extract employee name: find Hebrew text items near the employee_name column X
      // If no name column was identified, use the rightmost Hebrew text that isn't a known header/branch keyword
      let employeeName = ''

      if (nameColumnX >= 0) {
        // Find Hebrew items closest to nameColumnX
        const hebrewItems = row.filter(it => /[\u05D0-\u05EA]/.test(it.text))
        let bestItem: PdfItem | null = null
        let bestDist = Infinity
        for (const it of hebrewItems) {
          const dist = Math.abs(it.x - nameColumnX)
          if (dist < bestDist) {
            bestDist = dist
            bestItem = it
          }
        }
        if (bestItem && bestDist <= 60) {
          employeeName = bestItem.text
        }
      }

      if (!employeeName) {
        // Fallback: find all Hebrew text items and pick the one that looks like a name
        const hebrewItems = row.filter(it =>
          /[\u05D0-\u05EA]/.test(it.text) &&
          !it.text.includes('סה"כ') &&
          !/^[א-ת]'$/.test(it.text) // Skip day-of-week like ד', א'
        )
        // The employee name is typically the rightmost Hebrew text (highest X in LTR PDF coords)
        // or at a specific known X. Try the item with the highest X that's NOT a single-char day abbreviation.
        const candidates = hebrewItems.filter(it => it.text.length > 2)
        if (candidates.length > 0) {
          // If there's a branch column, the employee name is a different Hebrew text
          const branchX = columnXs.get('branch')
          if (branchX !== undefined && candidates.length >= 2) {
            // Separate branch from employee name by X proximity to branch column
            const sorted = candidates.sort((a, b) => {
              const aDist = Math.abs(a.x - branchX)
              const bDist = Math.abs(b.x - branchX)
              return aDist - bDist
            })
            // The closest to branchX is the branch name, the other is the employee name
            employeeName = sorted.length > 1 ? sorted[1].text : sorted[0].text
          } else {
            // Just take the rightmost Hebrew text
            employeeName = candidates.sort((a, b) => b.x - a.x)[0].text
          }
        }
      }

      if (!employeeName) {
        if (dataRowCount <= 5) {
          console.warn(`[parseWorkingHours] TABULAR: Row at page ${pageIdx + 1} Y=${y} — no employee name found. Items: ${row.map(it => `${it.text}(${it.x})`).join(' | ')}`)
        }
        continue
      }

      // Clean employee name
      employeeName = employeeName.replace(/[0-9:,]/g, '').replace(/\s+/g, ' ').trim()
      if (!employeeName) continue

      // Extract hour values — map numeric/HH:MM items to columns
      const cellMap = new Map<string, number>()

      for (const item of row) {
        // Skip date, Hebrew text, day-of-week abbreviations
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(item.text)) continue
        if (/[\u05D0-\u05EA]/.test(item.text)) continue

        // Try HH:MM format
        const hhmmVal = parseHHMM(item.text)
        if (hhmmVal > 0) {
          const col = findClosestColumn(item.x, columnXs)
          if (col && !['register', 'branch', 'date', 'report_type', 'employee_name'].includes(col)) {
            cellMap.set(col, hhmmVal)
          }
          continue
        }

        // Try plain number
        const val = parseFloat(item.text.replace(/,/g, ''))
        if (!isNaN(val)) {
          const col = findClosestColumn(item.x, columnXs)
          if (col && !['register', 'branch', 'date', 'report_type', 'employee_name'].includes(col)) {
            cellMap.set(col, val)
          }
        }
      }

      // Compute total hours
      const h100 = cellMap.get('regular') || 0
      const h125 = cellMap.get('level1') || 0
      const h150 = cellMap.get('level2') || 0
      const hExcept = cellMap.get('exceptions') || 0
      let totalH = cellMap.get('total_hours') || 0

      // If no explicit total, sum the parts
      if (totalH <= 0) {
        totalH = h100 + h125 + h150 + hExcept
      }

      if (totalH <= 0) {
        // Try using entry/exit times to compute total
        const entryH = cellMap.get('entry_time') || 0
        const exitH = cellMap.get('exit_time') || 0
        if (exitH > entryH) totalH = exitH - entryH
      }

      if (totalH <= 0) continue

      const key = `${employeeName}|${dateStr}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      employees.push({
        name: employeeName,
        date: dateStr,
        total_hours: Math.round(totalH * 100) / 100,
        hours_100: Math.round(h100 * 100) / 100,
        hours_125: Math.round(h125 * 100) / 100,
        hours_150: Math.round(h150 * 100) / 100,
      })

      // Debug: log first 3 data rows
      if (debugRows.length < 3) {
        debugRows.push(
          `  Row ${dataRowCount}: employee="${employeeName}", date=${dateStr}, total=${totalH}, h100=${h100}, h125=${h125}, h150=${h150}, cells=${JSON.stringify(Object.fromEntries(cellMap))}`
        )
      }
    }
  }

  console.log(`[parseWorkingHours] TABULAR: Processed ${dataRowCount} data rows`)
  if (debugRows.length > 0) {
    console.log(`[parseWorkingHours] TABULAR: First ${debugRows.length} parsed rows:\n${debugRows.join('\n')}`)
  }
  console.log(`[parseWorkingHours] TABULAR: Resulted in ${employees.length} employee-day records for ${new Set(employees.map(e => e.name)).size} unique employees`)
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
