/**
 * TimeWatch PDF Parser
 *
 * Parses attendance reports from TimeWatch system.
 * Format: "דוח נוכחות כל העובדים ברצף"
 *
 * Columns (RTL, right to left):
 *   שם העובד | מספר עובד | ת.ז. | תאריך | יום | סוג יום | שם יום | רכיב מיוחד | העדרות |
 *   כניסה/יציאה... | שעות נוכחות סה"כ | הפסקה | שעות עבודה | שעות תקן | שעות רגילות |
 *   ש.נ 125% | ש.נ 150% | ש.נ 175% | ש.נ 200% | ש.נ. שונות | שעות עודפות | שעות העדרות
 *
 * Strategy:
 * - Extract full text from PDF (pdfjs-dist)
 * - Parse as a structured text report — each employee row has a date pattern DD-MM-YYYY
 * - The CSV export from TimeWatch uses fixed column indices
 * - For PDF, we parse each line looking for the date pattern and extract numbers
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export interface TimeWatchRow {
  name: string
  employee_number: string
  date: string // YYYY-MM-DD
  hours_100: number
  hours_125: number
  hours_150: number
}

/**
 * Convert DD-MM-YYYY to YYYY-MM-DD
 */
function convertDate(raw: string): string | null {
  const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * Parse TimeWatch PDF and extract attendance rows.
 * Uses text content extraction with position-based column mapping.
 */
export async function parseTimeWatchPDF(file: File): Promise<TimeWatchRow[]> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const rows: TimeWatchRow[] = []

  // We'll collect all text items with their positions across all pages
  // Then group by Y coordinate to reconstruct rows
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items = content.items
      .filter((it: any) => it.str?.trim())
      .map((it: any) => ({
        text: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
      }))

    // Group items by Y (same line = within 3px)
    items.sort((a: any, b: any) => b.y - a.y || a.x - b.x) // top to bottom, then left to right
    const lines: { y: number; items: typeof items }[] = []
    for (const item of items) {
      const existing = lines.find(l => Math.abs(l.y - item.y) <= 3)
      if (existing) {
        existing.items.push(item)
      } else {
        lines.push({ y: item.y, items: [item] })
      }
    }

    // For each line, check if it contains a date pattern DD-MM-YYYY
    // and extract employee name + hours
    for (const line of lines) {
      // Sort items by X (right to left in RTL = highest X first)
      line.items.sort((a: any, b: any) => b.x - a.x)
      const fullText = line.items.map((it: any) => it.text).join(' ')

      // Find date in the line
      const dateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/)
      if (!dateMatch) continue
      const isoDate = convertDate(dateMatch[1])
      if (!isoDate) continue

      // Skip header rows
      if (fullText.includes('תאריך') && fullText.includes('שם העובד')) continue
      if (fullText.includes('לתשומת')) continue

      // Extract employee name — it's the rightmost text that isn't a number or date
      // In RTL, the name is at the highest X values
      const nameItems = line.items
        .filter((it: any) =>
          !it.text.match(/^\d/) &&
          !it.text.match(/^[-(]/) &&
          !it.text.includes('-') &&
          it.text !== 'א' && it.text !== 'ב' && it.text !== 'ג' && it.text !== 'ד' && it.text !== 'ה' && it.text !== 'ו' &&
          !it.text.includes('ראשון') && !it.text.includes('שני') && !it.text.includes('שלישי') &&
          !it.text.includes('רביעי') && !it.text.includes('חמישי') && !it.text.includes('שישי') && !it.text.includes('שבת') &&
          !it.text.includes('עבודה') && !it.text.includes('ייצור') && !it.text.includes('הפסקה') &&
          !it.text.includes('מחלה') && !it.text.includes('חסרה') && !it.text.includes('כניסה') &&
          !it.text.includes('תשלום') && !it.text.includes('בלי') && !it.text.includes('ללא')
        )

      // Name is typically the items with highest X that form Hebrew text
      // (We'll refine after seeing what items look like)
    }
  }

  // --- Better approach: parse as full-page text using column positions ---
  // The TimeWatch PDF has a fixed column layout. We need to find the header row
  // and use its X positions to map data cells to columns.

  return await parseTimeWatchByColumns(file)
}

interface TextItem { text: string; x: number; y: number }

async function parseTimeWatchByColumns(file: File): Promise<TimeWatchRow[]> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const rows: TimeWatchRow[] = []

  // Collect ALL items from ALL pages with position
  const allItems: (TextItem & { page: number })[] = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items as any[]) {
      if (!it.str?.trim()) continue
      allItems.push({
        text: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        page: p,
      })
    }
  }

  // Group by page, then by Y line (within 4px)
  const pageMap = new Map<number, typeof allItems>()
  for (const it of allItems) {
    if (!pageMap.has(it.page)) pageMap.set(it.page, [])
    pageMap.get(it.page)!.push(it)
  }

  // Find header row: contains "שעות רגילות" and "125"
  // The header establishes column X positions
  let headerCols = {
    nameX: 0,        // שם העובד
    empNumX: 0,      // מספר עובד
    dateX: 0,        // תאריך
    h100X: 0,        // שעות רגילות
    h125X: 0,        // ש.נ 125%
    h150X: 0,        // ש.נ 150%
    workHoursX: 0,   // שעות עבודה
  }
  let headerFound = false

  // Scan each page for header
  for (const [pageNum, items] of pageMap) {
    // Group into lines
    const lines = groupIntoLines(items, 4)

    for (const line of lines) {
      const text = line.map(it => it.text).join(' ')
      if (text.includes('רגילות') && text.includes('125')) {
        // Found header line
        for (const it of line) {
          if (it.text.includes('רגילות') && !it.text.includes('סה')) headerCols.h100X = it.x
          if (it.text.includes('125')) headerCols.h125X = it.x
          if (it.text.includes('150')) headerCols.h150X = it.x
          if (it.text === 'שעות' && it.x > headerCols.h100X) headerCols.workHoursX = it.x
        }
        headerFound = true
        console.log('[parseTimeWatch] Header found on page', pageNum, headerCols)
        break
      }
    }
    if (headerFound) break
  }

  if (!headerFound) {
    console.warn('[parseTimeWatch] Header not found, trying text-based parsing')
    return parseTimeWatchTextBased(allItems)
  }

  // Now parse data rows on each page
  // Employee names and numbers are on lines with dates (DD-MM-YYYY pattern)
  let currentName = ''
  let currentEmpNum = ''

  for (const [pageNum, items] of pageMap) {
    const lines = groupIntoLines(items, 4)

    for (const line of lines) {
      const fullText = line.map(it => it.text).join(' ')

      // Skip non-data lines
      if (fullText.includes('דוח נוכחות') || fullText.includes('שם החברה') ||
          fullText.includes('שם העובד') && fullText.includes('מספר') ||
          fullText.includes('כניסה') && fullText.includes('יציאה') && fullText.includes('כמות') ||
          fullText.includes('לתשומת') || fullText.includes('TimeWatch') ||
          fullText.includes('כל הזכויות') || fullText.includes('תדפיס')) continue

      // Check if this line has a date DD-MM-YYYY
      const dateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/)
      if (!dateMatch) continue
      const isoDate = convertDate(dateMatch[1])
      if (!isoDate) continue

      // Find employee name: rightmost Hebrew text that isn't a day name or type
      // Sort by X desc (rightmost first in RTL)
      const sortedByX = [...line].sort((a, b) => b.x - a.x)

      // The name is the first Hebrew text item (rightmost) that's a real name
      let name = ''
      let empNum = ''
      for (const it of sortedByX) {
        // Employee name: Hebrew text, not a day/type keyword
        if (/[\u0590-\u05FF]/.test(it.text) && !name) {
          const skip = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
            'עבודה', 'ייצור', 'הפסקה', 'מחלה', 'חסרה', 'כניסה', 'יציאה', 'תשלום',
            'בלי', 'ללא', 'מנוחה', 'חופש', 'חופשה', 'בתשלום', 'שבתון']
          if (!skip.some(s => it.text.includes(s)) && it.text.length > 1) {
            name = it.text
          }
        }
        // Employee number: 3-4 digit number right after name
        if (!empNum && /^\d{1,4}$/.test(it.text) && it.x < (name ? sortedByX.find(i => i.text === name)?.x || 999 : 999)) {
          empNum = it.text
        }
      }

      // If no name found on this line, might be continuation line (happens in multi-line entries)
      // In that case, also look for ALL_CAPS English names (foreign workers)
      if (!name) {
        for (const it of sortedByX) {
          if (/^[A-Z][A-Z\s]+$/.test(it.text) && it.text.length > 3) {
            name = it.text
            break
          }
        }
      }

      if (!name) continue

      // Update current employee tracking
      if (name !== currentName) {
        currentName = name
        currentEmpNum = empNum || currentEmpNum
      }

      // Extract hours using column positions
      // Find number closest to each header column X
      const numbers = line.filter(it => /^[\d.]+$/.test(it.text.replace(',', '')))

      const h100 = findClosestNumber(numbers, headerCols.h100X, 30)
      const h125 = findClosestNumber(numbers, headerCols.h125X, 30)
      const h150 = findClosestNumber(numbers, headerCols.h150X, 30)

      // Skip rows with no hours
      if (h100 === 0 && h125 === 0 && h150 === 0) continue

      rows.push({
        name: currentName,
        employee_number: currentEmpNum || empNum,
        date: isoDate,
        hours_100: h100,
        hours_125: h125,
        hours_150: h150,
      })
    }
  }

  console.log(`[parseTimeWatch] Parsed ${rows.length} rows for ${new Set(rows.map(r => r.name)).size} employees`)
  return rows
}

function groupIntoLines(items: TextItem[], tolerance: number): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || b.x - a.x)
  const lines: TextItem[][] = []
  for (const item of sorted) {
    const existing = lines.find(l => Math.abs(l[0].y - item.y) <= tolerance)
    if (existing) {
      existing.push(item)
    } else {
      lines.push([item])
    }
  }
  return lines
}

function findClosestNumber(items: TextItem[], targetX: number, maxDist: number): number {
  let best: TextItem | null = null
  let bestDist = maxDist + 1
  for (const it of items) {
    const dist = Math.abs(it.x - targetX)
    if (dist < bestDist) {
      bestDist = dist
      best = it
    }
  }
  if (!best) return 0
  return parseFloat(best.text.replace(',', '')) || 0
}

/**
 * Fallback: text-based parsing when header columns can't be found.
 * Uses the known CSV column order from TimeWatch exports.
 */
function parseTimeWatchTextBased(allItems: (TextItem & { page: number })[]): TimeWatchRow[] {
  const rows: TimeWatchRow[] = []

  // Group all items by page and line
  const pageMap = new Map<number, typeof allItems>()
  for (const it of allItems) {
    if (!pageMap.has(it.page)) pageMap.set(it.page, [])
    pageMap.get(it.page)!.push(it)
  }

  for (const [, items] of pageMap) {
    const lines = groupIntoLines(items, 4)

    for (const line of lines) {
      const fullText = line.map(it => it.text).join(' ')
      const dateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/)
      if (!dateMatch) continue
      const isoDate = convertDate(dateMatch[1])
      if (!isoDate) continue

      // Skip headers
      if (fullText.includes('שם העובד') || fullText.includes('לתשומת')) continue

      // Find name
      const sortedByX = [...line].sort((a, b) => b.x - a.x)
      let name = ''
      for (const it of sortedByX) {
        if (/[\u0590-\u05FF]/.test(it.text) && it.text.length > 1) {
          const skip = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
            'עבודה', 'ייצור', 'הפסקה', 'מחלה', 'חסרה', 'כניסה', 'תשלום', 'ללא', 'בתשלום']
          if (!skip.some(s => it.text.includes(s))) {
            name = it.text
            break
          }
        }
        if (/^[A-Z][A-Z\s]+$/.test(it.text) && it.text.length > 3) {
          name = it.text
          break
        }
      }
      if (!name) continue

      // Get all numbers sorted by X ascending (leftmost first = hours columns in PDF)
      const nums = line
        .filter(it => /^[\d.]+$/.test(it.text.replace(',', '')))
        .sort((a, b) => a.x - b.x)
        .map(it => parseFloat(it.text.replace(',', '')) || 0)

      // In TimeWatch format, the hours are at specific positions from the left
      // The pattern is typically: ... | שעות רגילות | ש.נ 125% | ש.נ 150% | ...
      // Without header mapping, we try to find the hours by pattern matching
      if (nums.length >= 3) {
        // Last few numbers from left are usually: hours_100, hours_125, hours_150
        const h100 = nums[nums.length - 3] || 0
        const h125 = nums[nums.length - 2] || 0
        const h150 = nums[nums.length - 1] || 0
        if (h100 > 0 || h125 > 0 || h150 > 0) {
          rows.push({ name, employee_number: '', date: isoDate, hours_100: h100, hours_125: h125, hours_150: h150 })
        }
      }
    }
  }

  return rows
}
