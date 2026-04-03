/**
 * parseWorkingHoursPDF — חילוץ סיכומי עובדים מדו"ח נוכחות מפורט של CashOnTab
 *
 * אסטרטגיה: במקום לפענח כל שורה יומית (בעייתי בגלל RTL ועמודות קופה/סוג דיווח),
 * מחלצים מבלוק "סיכום לעובד" בלבד — שם יש שורה אחת ברורה של סה"כ שעות.
 *
 * מבנה הדו"ח:
 *   - כל עובד תופס דף/ים עם כותרת "שם עובד: ..."
 *   - בסוף כל עובד יש בלוק "סיכום לעובד"
 *   - בבלוק הסיכום יש 3 שורות: א-ה, שישי, שבת + שורת סה"כ
 *   - שורת סה"כ מכילה: סה"כ_שעות | רגילות | רמה1 | רמה2 | חריגות
 */

export interface ParsedEmployee {
  name: string
  date: string          // תאריך סיום (date_to) — YYYY-MM-DD
  total_hours: number   // סה"כ שעות
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

// ─── חילוץ טקסט גולמי מכל דף ─────────────────────────────────────────────────
async function extractTextPerPage(file: File): Promise<string[]> {
  const lib = await loadPdfJs()
  const buf = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise
  const pages: string[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()

    // Group items by Y coordinate, then sort each group by X (right-to-left for Hebrew)
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

    // Group by Y (tolerance 4px)
    const yGroups = new Map<number, PdfItem[]>()
    for (const item of items) {
      let matched = false
      for (const [key] of yGroups) {
        if (Math.abs(key - item.y) <= 4) {
          yGroups.get(key)!.push(item)
          matched = true
          break
        }
      }
      if (!matched) yGroups.set(item.y, [item])
    }

    // Sort lines top-to-bottom (higher Y = higher on page in PDF coords → sort descending)
    const sortedYKeys = [...yGroups.keys()].sort((a, b) => b - a)
    const lineTexts: string[] = []
    for (const y of sortedYKeys) {
      const row = yGroups.get(y)!
      // Sort items within line right-to-left (higher X first) for Hebrew
      row.sort((a, b) => b.x - a.x)
      lineTexts.push(row.map(it => it.text).join(' '))
    }

    pages.push(lineTexts.join('\n'))
  }

  return pages
}

// ─── פרסור ראשי ─────────────────────────────────────────────────────────────
export async function parseWorkingHoursPDF(file: File): Promise<{
  employees: ParsedEmployee[]
  rawPages: string[]
}> {
  const rawPages = await extractTextPerPage(file)

  // Debug: dump raw text per page
  rawPages.forEach((text, i) => {
    console.log(`[parseWorkingHours] ── PAGE ${i + 1} ──`)
    console.log(text)
  })

  // Join all pages into one long text
  const allText = rawPages.join('\n')

  // ── שלב 1: חלץ טווח תאריכים ──
  // "עד תאריך DD/MM/YY" or "עד תאריך DD/MM/YYYY"
  let dateTo = ''
  const dateToMatch = allText.match(/עד תאריך\s+(\d{2})\/(\d{2})\/(\d{2,4})/)
  if (dateToMatch) {
    const dd = dateToMatch[1]
    const mm = dateToMatch[2]
    let yyyy = dateToMatch[3]
    if (yyyy.length === 2) yyyy = '20' + yyyy
    dateTo = `${yyyy}-${mm}-${dd}`
  }

  if (!dateTo) {
    console.warn('[parseWorkingHours] Could not find עד תאריך')
  }

  // ── שלב 2: מצא כל בלוק עובד ──
  // Split by "שם עובד:" — each block is one employee
  // But we need to handle the case where "שם עובד:" appears within a line
  const employees: ParsedEmployee[] = []

  // Find all employee blocks using "סיכום לעובד" and the preceding "שם עובד:"
  // Strategy: find all "שם עובד:" positions and pair with the next "סיכום לעובד"
  const lines = allText.split('\n')

  let currentName = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // ── זיהוי שם עובד ──
    const nameMatch = line.match(/שם עובד[:\s]+([^\n]+?)(?:\s+קוד|\s*$)/)
    if (nameMatch) {
      const rawName = nameMatch[1].trim().replace(/\s+/g, ' ')
      if (rawName) currentName = rawName
    }

    // ── חיפוש שורת סה"כ שעות בסיכום ──
    // The last row in the summary section contains the totals
    // It looks like: "4.97 19.51 112.70 137.18" (or with "סה"כ שעות" prefix)
    // We detect this by looking for the "סיכום לעובד" marker
    if (line.includes('סיכום לעובד') || line.includes('סיכום')) {
      if (!currentName) continue

      // Scan forward to find the total line
      // The summary block has:
      //   "סה"כ ימי נוכחות א-ה" → row with weekday totals
      //   "סה"כ ימי נוכחות שישי" → row with Friday totals
      //   "סה"כ ימי נוכחות שבת"
      //   "סה"כ ימים עם דיווח חסר"
      //   Then: the TOTALS row (last row with numbers before next employee)
      //   Format: סה"כ_שעות רגילות רמה1 רמה2 חריגות

      // Look at lines after "סיכום לעובד" to find "סה"כ שעות" or the last numeric line
      let totalHours = 0, h100 = 0, h125 = 0, h150 = 0
      let foundTotals = false

      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const sumLine = lines[j]

        // Stop if we hit next employee or next page marker
        if (sumLine.includes('שם עובד:') || sumLine.includes('דו"ח נוכחות') || sumLine.includes('CashOnTab')) break

        // Look for "סה"כ שעות" line or the final totals line
        // The totals line has the overall sums — it's the one with the largest numbers
        // It typically follows after "סה"כ ימי נוכחות שבת" and "סה"כ ימים עם דיווח חסר"
        if (sumLine.includes('סה"כ שעות') || sumLine.includes('שעות כ"סה')) {
          // Extract all numbers from this line
          const nums = extractNumbers(sumLine)
          console.log(`[parseWorkingHours] ${currentName} סה"כ שעות line: "${sumLine}" → nums: [${nums}]`)
          if (nums.length >= 2) {
            // Numbers in RTL line (right-to-left): סה"כ, רגילות, רמה1, רמה2, חריגות
            // The largest number is סה"כ שעות
            const sorted = [...nums].sort((a, b) => b - a)
            totalHours = sorted[0]

            // Find the combination that sums to totalHours
            const rest = nums.filter((_, idx) => nums[idx] !== totalHours || idx !== nums.indexOf(sorted[0]))
            // Actually simpler: the sum of רגילות + רמה1 + רמה2 + חריגות = סה"כ
            // So remove סה"כ and take the rest sorted descending
            const components = [...rest].sort((a, b) => b - a)
            h100 = components[0] || 0
            h125 = components[1] || 0
            h150 = components[2] || 0

            foundTotals = true
            break
          }
        }

        // Also look for a line that just has numbers (the totals row at the very end)
        // This is the line right before a blank line or next section
        const nums = extractNumbers(sumLine)
        if (nums.length >= 4) {
          // Could be the totals row: totalH, regular, level1, level2, exceptions
          const sorted = [...nums].sort((a, b) => b - a)
          // Only accept if largest is > 10 (likely total hours for a month)
          if (sorted[0] > 10) {
            totalHours = sorted[0]
            const rest = [...nums]
            const maxIdx = rest.indexOf(totalHours)
            rest.splice(maxIdx, 1)
            const components = rest.sort((a, b) => b - a)
            h100 = components[0] || 0
            h125 = components[1] || 0
            h150 = components[2] || 0
            foundTotals = true
            // Don't break — keep scanning for a more specific "סה"כ שעות" line
          }
        }
      }

      if (foundTotals && totalHours > 0) {
        console.log(`[parseWorkingHours] ✅ ${currentName}: total=${totalHours}, h100=${h100}, h125=${h125}, h150=${h150}`)
        employees.push({
          name: currentName,
          date: dateTo,
          total_hours: totalHours,
          hours_100: h100,
          hours_125: h125,
          hours_150: h150,
        })
      } else {
        console.warn(`[parseWorkingHours] ⚠️ ${currentName}: no totals found after סיכום`)
      }
    }
  }

  return { employees, rawPages }
}

// ─── חילוץ מספרים מטקסט ─────────────────────────────────────────────────────
function extractNumbers(text: string): number[] {
  // Match numbers like 137.18, 96.70, 4.97, 0 etc.
  const matches = text.match(/\d+(?:\.\d+)?/g)
  if (!matches) return []
  return matches.map(s => parseFloat(s)).filter(v => !isNaN(v))
}
