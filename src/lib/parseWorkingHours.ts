/**
 * parseWorkingHoursPDF — חילוץ שורות יומיות מדו"ח נוכחות מפורט של CashOnTab
 *
 * פורמט הקובץ:
 * - כל עמוד = עובד אחד
 * - שורת כותרת: "קוד עובד: XXשם עובד: שם מלא"
 * - שורות נתונים: "DD/MM/YYYYHH:MM  יוםHH:MMREG.HHLVL1.HHLVL2.HHEXC.HH  TOTAL.HH  TYPEסניף"
 * - סיכום: "סיכום לעובד" עם סה"כ שעות
 *
 * עובדים עם כניסה ללא יציאה (0.00 שעות) נכללים עם הערה "דיווח חסר"
 */

export interface ParsedEmployee {
  name: string
  date: string          // YYYY-MM-DD
  total_hours: number
  hours_100: number     // רגילות
  hours_125: number     // רמה 1
  hours_150: number     // רמה 2
  branch?: string       // סניף
  incomplete?: boolean  // דיווח חסר
}

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

// ─── חילוץ טקסט מלא מכל עמוד ──────────────────────────────────────────────────
async function extractTextPerPage(file: File): Promise<string[]> {
  const lib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise
  const pages: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    // Join all text items with space, preserving order
    const text = content.items.map((item: any) => item.str).join('')
    pages.push(text)
  }
  return pages
}

// ─── פרסור ראשי ─────────────────────────────────────────────────────────────
export async function parseWorkingHoursPDF(file: File): Promise<{
  employees: ParsedEmployee[]
  rawPages: string[]
}> {
  const pages = await extractTextPerPage(file)
  const employees: ParsedEmployee[] = []
  const seenKeys = new Set<string>()
  const rawPages: string[] = []

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]
    rawPages.push(pageText.substring(0, 500))

    // ── Extract employee name ──
    // Format: "קוד עובד: XXשם עובד: NAME"
    const nameMatch = pageText.match(/שם\s*עובד:\s*(.+?)(?=תאריך|מחסנים|$)/)
    if (!nameMatch) {
      console.warn(`[parseWorkingHours] Page ${pageIdx + 1}: no employee name found`)
      continue
    }
    const name = nameMatch[1].trim()
      .replace(/\s+/g, ' ')
      .replace(/[0-9]/g, '')
      .trim()

    if (!name || name.length < 2) continue
    console.log(`[parseWorkingHours] Page ${pageIdx + 1}: found employee "${name}"`)

    // ── Extract branch from "מחסנים:" line ──
    const branchMatch = pageText.match(/מחסנים:\s*(.+?)(?=סניף|תאריך|$)/)
    const branchHint = branchMatch ? branchMatch[1].trim() : ''

    // ── Extract data rows ──
    // Split page text on date patterns to isolate each data row
    // Data row example: "09/04/202606:03  ה16:058.002.000.030.00                       10.03                 0אברהם אבינו1"
    // Numbers are concatenated: 8.002.000.030.00 = [8.00, 2.00, 0.03, 0.00]
    const segments = pageText.split(/(?=\d{2}\/\d{2}\/\d{4})/)

    for (const seg of segments) {
      const dateM = seg.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
      if (!dateM) continue

      const dateStr = `${dateM[3]}-${dateM[2]}-${dateM[1]}`

      // Skip header dates (מתאריך / עד תאריך / print timestamp)
      const segPos = pageText.indexOf(seg)
      if (segPos > 0) {
        const before = pageText.substring(Math.max(0, segPos - 15), segPos)
        if (before.includes('מתאריך') || before.includes('עד') || before.includes('תאריך')) continue
      }
      // Skip very short segments (timestamp at top of page)
      if (seg.length < 30) continue
      // Skip summary lines
      if (seg.includes('סיכום') || seg.includes('סה"כ ימי')) continue

      const key = `${name}|${dateStr}`
      if (seenKeys.has(key)) continue

      // Truncate segment at the next date or at summary keywords to avoid
      // picking up footer/summary numbers
      let cleanSeg = seg
      // Remove everything after next date pattern (if another date follows in same segment)
      const nextDateInSeg = cleanSeg.substring(11).search(/\d{2}\/\d{2}\/\d{4}/)
      if (nextDateInSeg >= 0) cleanSeg = cleanSeg.substring(0, 11 + nextDateInSeg)
      // Also truncate at summary keywords
      for (const kw of ['סיכום', 'סה"כ', 'רגילות', 'רמה', 'חריגות', 'עמוד', 'CashOnTab']) {
        const kwPos = cleanSeg.indexOf(kw)
        if (kwPos > 15) cleanSeg = cleanSeg.substring(0, kwPos)
      }
      // Also truncate at Hebrew branch names (אברהם, הפועלים, יעקב) — data ends there
      const branchPos = cleanSeg.search(/[א-ת]{2,}/)
      // But only if it's after the time fields (position > 25)
      const hebrewAfterData = cleanSeg.substring(25).search(/[א-ת]{2,}/)
      if (hebrewAfterData >= 0) cleanSeg = cleanSeg.substring(0, 25 + hebrewAfterData)

      // Remove time patterns HH:MM (e.g. "06:03", "16:05") so they don't
      // bleed into hour decimals (e.g. "12:558.00" → "558.00" = wrong)
      const noTimes = cleanSeg.replace(/\d{2}:\d{2}/g, ' ')

      // Extract all X.XX numbers from the cleaned segment
      const nums = noTimes.match(/\d+\.\d{2}/g)
      if (!nums || nums.length < 1) continue

      const values = nums.map(n => parseFloat(n))

      // The first 4 numbers are: regular, level1, level2, exceptions
      // Then after whitespace: total_hours
      // Pattern: REG.HHLVL1.HHLVL2.HHEXC.HH   TOTAL.HH
      let regular = 0, level1 = 0, level2 = 0, exceptions = 0, totalH = 0

      if (values.length >= 5) {
        // Standard: [regular, level1, level2, exceptions, total]
        regular = values[0]
        level1 = values[1]
        level2 = values[2]
        exceptions = values[3]
        totalH = values[4]
      } else if (values.length === 4) {
        regular = values[0]
        level1 = values[1]
        level2 = values[2]
        totalH = values[3]
      } else if (values.length >= 1) {
        // Incomplete report — just total or just regular
        totalH = values[values.length - 1]
        regular = values[0]
      }

      // Validate: total should be >= regular
      // If total seems wrong, recalculate
      if (totalH < regular && values.length >= 5) {
        // Maybe the order is different, try finding total as the value closest to sum
        const expectedSum = regular + level1 + level2
        for (const v of values) {
          if (Math.abs(v - expectedSum) < 0.5 && v > 0) {
            totalH = v
            break
          }
        }
      }

      const isIncomplete = totalH === 0
      seenKeys.add(key)

      employees.push({
        name,
        date: dateStr,
        total_hours: Math.round(totalH * 100) / 100,
        hours_100: Math.round(regular * 100) / 100,
        hours_125: Math.round(level1 * 100) / 100,
        hours_150: Math.round(level2 * 100) / 100,
        incomplete: isIncomplete || undefined,
      })
    }
  }

  // Sort by name, then date
  employees.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))

  console.log(`[parseWorkingHours] Total: ${employees.length} daily rows for ${new Set(employees.map(e => e.name)).size} employees`)
  return { employees, rawPages }
}
