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
    // Data rows start with DD/MM/YYYY and contain hours data
    // Pattern: DD/MM/YYYYHH:MM  DAY_LETTERHH:MM or DD/MM/YYYYHH:MM  DAY_LETTER (no exit = incomplete)
    // Then: REGULAR.HH LEVEL1.HH LEVEL2.HH EXCEPTIONS.HH ... TOTAL.HH ... TYPE BRANCH
    const dataRowRegex = /(\d{2}\/\d{2}\/\d{4})(\d{2}:\d{2})\s{0,3}([א-ת])([\d:]{5})?([\d.]+)\s*([\d.]+)\s*([\d.]+)\s*([\d.]+)\s+([\d.]+)\s+(\d)([א-ת\s]+?)(\d+)(?=\d{2}\/\d{2}\/\d{4}|סיכום|$)/g

    let match
    while ((match = dataRowRegex.exec(pageText)) !== null) {
      const dateRaw = match[1] // DD/MM/YYYY
      const entryTime = match[2]
      const dayLetter = match[3]
      const exitTime = match[4] || '' // may be missing
      const regular = parseFloat(match[5]) || 0
      const level1 = parseFloat(match[6]) || 0
      const level2 = parseFloat(match[7]) || 0
      const exceptions = parseFloat(match[8]) || 0
      const totalHours = parseFloat(match[9]) || 0
      const reportType = match[10]
      const branchName = match[11]?.trim() || ''

      const [dd, mm, yyyy] = dateRaw.split('/')
      const dateStr = `${yyyy}-${mm}-${dd}`

      const key = `${name}|${dateStr}`
      if (seenKeys.has(key)) continue
      seenKeys.add(key)

      const isIncomplete = totalHours === 0 && !exitTime

      employees.push({
        name,
        date: dateStr,
        total_hours: Math.round(totalHours * 100) / 100,
        hours_100: Math.round(regular * 100) / 100,
        hours_125: Math.round(level1 * 100) / 100,
        hours_150: Math.round(level2 * 100) / 100,
        branch: branchName || branchHint.split(',')[0]?.trim() || undefined,
        incomplete: isIncomplete || undefined,
      })
    }

    // ── Fallback: simpler regex if the strict one didn't match ──
    if (!employees.some(e => e.name === name)) {
      // Try line-by-line approach on the concatenated text
      // Split on date patterns to find data segments
      const segments = pageText.split(/(?=\d{2}\/\d{2}\/\d{4})/)

      for (const seg of segments) {
        const dateM = seg.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
        if (!dateM) continue

        const dateStr = `${dateM[3]}-${dateM[2]}-${dateM[1]}`

        // Skip if it looks like a header date (מתאריך/עד תאריך)
        if (pageText.indexOf(seg) > 0) {
          const before = pageText.substring(Math.max(0, pageText.indexOf(seg) - 10), pageText.indexOf(seg))
          if (before.includes('מתאריך') || before.includes('עד')) continue
        }
        // Skip the print date at top (usually short segment)
        if (seg.length < 20) continue

        const key = `${name}|${dateStr}`
        if (seenKeys.has(key)) continue

        // Extract numbers from the segment
        const nums = seg.match(/\d+\.\d{2}/g)
        if (!nums || nums.length < 3) continue

        // In the data row, the pattern is: regular, level1, level2, exceptions, ..., total
        // The total is usually the largest or the one after a gap
        const values = nums.map(n => parseFloat(n))

        // Find total: it's typically > sum of components
        let regular = values[0] || 0
        let level1 = values[1] || 0
        let level2 = values[2] || 0
        let totalH = 0

        // Look for the total hours value (should be close to regular + level1 + level2)
        for (let i = 3; i < values.length; i++) {
          const v = values[i]
          const expectedTotal = regular + level1 + level2
          if (Math.abs(v - expectedTotal) < 1 && v > 0) {
            totalH = v
            break
          }
        }

        // If no matching total found, use the largest value that's > regular
        if (totalH === 0) {
          for (const v of values) {
            if (v >= regular && v < 24) totalH = Math.max(totalH, v)
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
  }

  // Sort by name, then date
  employees.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date))

  console.log(`[parseWorkingHours] Total: ${employees.length} daily rows for ${new Set(employees.map(e => e.name)).size} employees`)
  return { employees, rawPages }
}
