/**
 * TimeWatch PDF Parser
 *
 * Parses attendance reports from TimeWatch system.
 * Format: "דוח נוכחות כל העובדים ברצף"
 *
 * PDF column layout (visual RTL, right to left):
 *   שם העובד → מספר עובד → ת.ז. → תאריך → ... → כניסה/יציאה →
 *   שעות נוכחות → הפסקה → שעות עבודה → שעות תקן → שעות רגילות →
 *   ש.נ 125% → ש.נ 150% → ש.נ 175% → ...
 *
 * In PDF coordinates (X=0 is LEFT): hours columns are at LOW X values.
 * Strategy: find header X positions for רגילות, 125%, 150%, then map data cells.
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

interface TextItem { text: string; x: number; y: number }

function convertDate(raw: string): string | null {
  const m = raw.match(/(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
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

export async function parseTimeWatchPDF(file: File): Promise<TimeWatchRow[]> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const rows: TimeWatchRow[] = []

  // Collect all text items across all pages
  const allPages: { page: number; items: TextItem[] }[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const items: TextItem[] = content.items
      .filter((it: any) => it.str?.trim())
      .map((it: any) => ({
        text: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
      }))
    allPages.push({ page: p, items })
  }

  // ─── Step 1: Find header column X positions ───
  // Dump all unique text items from page 1 for debugging
  if (allPages.length > 0) {
    const p1 = allPages[0].items
    const uniqueTexts = [...new Set(p1.map(it => it.text))]
    console.log('[parseTimeWatch] Page 1 unique texts:', uniqueTexts.join(' | '))
    // Show items that might be header-related
    const headerItems = p1.filter(it =>
      it.text.includes('שעות') || it.text.includes('רגיל') || it.text.includes('תקן') ||
      it.text.includes('125') || it.text.includes('150') || it.text.includes('ש.נ') ||
      it.text.includes('עבודה') || it.text.includes('נוכחות')
    )
    console.log('[parseTimeWatch] Header-related items:', headerItems.map(it => `"${it.text}"(x=${it.x},y=${it.y})`))
  }

  let h100X = -1 // שעות רגילות
  let h125X = -1 // ש.נ 125%
  let h150X = -1 // ש.נ 150%

  for (const { items } of allPages) {
    for (const it of items) {
      // Look for "רגילות" (may be split by pdfjs into individual chars)
      if (it.text.includes('רגיל')) {
        if (h100X < 0 || it.x < h100X) h100X = it.x
      }
      // Look for "125.00%" or "125%" in header
      if (it.text.includes('125') && (it.text.includes('%') || it.text.length <= 7)) {
        if (h125X < 0) h125X = it.x
      }
      // Look for "150.00%" or "150%" in header
      if (it.text.includes('150') && (it.text.includes('%') || it.text.length <= 7)) {
        if (h150X < 0) h150X = it.x
      }
    }
    if (h125X >= 0) break // 125% is the most reliable marker
  }

  // Hebrew header text is often split into individual characters by pdfjs,
  // so "רגילות" may not be found. Infer h100X from column spacing.
  // Layout (ascending X): ... | 150%(x=187) | 125%(x=209) | רגילות(x≈231) | תקן | עבודה | ...
  if (h100X < 0 && h125X >= 0 && h150X >= 0) {
    const spacing = h125X - h150X
    h100X = h125X + spacing
    console.log(`[parseTimeWatch] Inferred h100X=${h100X} from spacing=${spacing}`)
  } else if (h100X < 0 && h125X >= 0) {
    h100X = h125X + 22 // default spacing
    console.log(`[parseTimeWatch] Inferred h100X=${h100X} with default spacing`)
  }

  console.log('[parseTimeWatch] Final header columns:', { h100X, h125X, h150X })

  if (h100X < 0 && h125X < 0) {
    console.warn('[parseTimeWatch] Could not find any header columns, using text-based fallback')
    return parseTimeWatchFallback(allPages)
  }

  // ─── Step 2: Parse data rows ───
  for (const { page, items } of allPages) {
    const lines = groupIntoLines(items, 4)

    for (const line of lines) {
      const fullText = line.map(it => it.text).join(' ')

      // Must have a date DD-MM-YYYY
      const dateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/)
      if (!dateMatch) continue
      const isoDate = convertDate(dateMatch[1])
      if (!isoDate) continue

      // Skip header/footer lines
      if (fullText.includes('שם העובד') || fullText.includes('לתשומת') ||
          fullText.includes('TimeWatch') || fullText.includes('כל הזכויות') ||
          fullText.includes('דוח נוכחות') || fullText.includes('תדפיס')) continue

      // ── Find employee name ──
      // pdfjs splits Hebrew text into individual characters, so we can't just
      // look for a single text item with the full name.
      // Strategy: find the date item's X, then collect all items to its RIGHT
      // (higher X = name/number/ID area in RTL layout)
      const dateItem = line.find(it => it.text.match(/\d{2}-\d{2}-\d{4}/))
      if (!dateItem) continue
      const dateX = dateItem.x

      // Items to the RIGHT of date (higher X) = name area
      // Add margin to skip day letter (א, ב, etc.) which is close to date
      const nameAreaItems = line
        .filter(it => it.x > dateX + 15)
        .sort((a, b) => b.x - a.x) // rightmost first

      let name = ''
      let empNum = ''

      // Check for complete English name first (foreign workers - rendered as one item)
      const englishItem = nameAreaItems.find(it => /^[A-Z][A-Z\s]{3,}/.test(it.text))
      if (englishItem) {
        name = englishItem.text
      }

      if (!name) {
        // Reconstruct Hebrew name from individual character items
        // Hebrew chars in the name area, sorted by X descending (RTL reading order)
        const hebrewChars = nameAreaItems
          .filter(it => /^[\u0590-\u05FF]$/.test(it.text) || (/[\u0590-\u05FF]/.test(it.text) && it.text.length > 1))
          .sort((a, b) => b.x - a.x)

        if (hebrewChars.length > 0) {
          // Calculate median gap between adjacent chars to determine word boundaries
          const gaps: number[] = []
          for (let i = 1; i < hebrewChars.length; i++) {
            gaps.push(hebrewChars[i - 1].x - hebrewChars[i].x)
          }
          // Word boundary = gap significantly larger than typical char spacing
          // Typical char gap: ~4-5px, word gap: ~7-10px
          const sortedGaps = [...gaps].sort((a, b) => a - b)
          const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 5
          // Use 1.4x median with min 7px — catches word gaps of ~7px when char gaps are ~5px
          const wordBreakThreshold = Math.max(medianGap * 1.4, 7)

          // Debug: log gaps for first Hebrew name
          if (rows.length === 0) {
            console.log(`[parseTimeWatch] Hebrew name gaps: median=${medianGap.toFixed(1)}, threshold=${wordBreakThreshold.toFixed(1)}, gaps=[${sortedGaps.map(g => g.toFixed(1)).join(',')}]`)
          }

          const words: string[] = []
          let currentWord = hebrewChars[0].text
          let lastX = hebrewChars[0].x

          for (let i = 1; i < hebrewChars.length; i++) {
            const gap = lastX - hebrewChars[i].x
            if (gap > wordBreakThreshold) {
              words.push(currentWord)
              currentWord = hebrewChars[i].text
            } else {
              currentWord += hebrewChars[i].text
            }
            lastX = hebrewChars[i].x
          }
          words.push(currentWord)

          // Filter out day names and keywords
          const skipWords = new Set(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
            'עבודה', 'ייצור', 'הפסקה', 'מחלה', 'חסרה', 'כניסה', 'יציאה', 'תשלום',
            'ללא', 'בתשלום', 'יום', 'בע', 'מ', 'א', 'ב', 'ג', 'ד', 'ה', 'ו'])
          const nameWords = words.filter(w => w.length > 1 && !skipWords.has(w))
          name = nameWords.join(' ')
        }
      }

      // Find employee number: 2-4 digit number in the name area
      for (const it of nameAreaItems) {
        if (/^\d{2,4}$/.test(it.text) && parseInt(it.text) < 2000) {
          empNum = it.text
          break
        }
      }

      if (!name || name.length < 2) continue

      // ── Extract hours by column position ──
      // Only consider numbers that are reasonable hours (0-24)
      const numItems = line.filter(it => {
        if (it.text.includes(':')) return false // times like 06:32
        const clean = it.text.replace(/[(),\-]/g, '')
        if (!/^\d+\.?\d*$/.test(clean)) return false
        const v = parseFloat(clean)
        return v >= 0 && v <= 24
      })

      // Debug: log first data row numbers with X positions
      if (rows.length === 0) {
        console.log('[parseTimeWatch] First row nums:', numItems.map(it => `${it.text}(x=${it.x})`).join(', '))
      }

      // Exclusive matching: each item can only match ONE column (closest)
      // Assign each numItem to its closest column, preventing double assignments
      let h100 = 0, h125 = 0, h150 = 0
      const usedItems = new Set<TextItem>()

      // Match h150 first (leftmost column)
      if (h150X >= 0) {
        const best = findClosestUnused(numItems, h150X, 20, usedItems)
        if (best) { h150 = parseFloat(best.text.replace(/[(),]/g, '')) || 0; usedItems.add(best) }
      }
      // Match h125 next
      if (h125X >= 0) {
        const best = findClosestUnused(numItems, h125X, 20, usedItems)
        if (best) { h125 = parseFloat(best.text.replace(/[(),]/g, '')) || 0; usedItems.add(best) }
      }
      // Match h100 last (rightmost of the three)
      if (h100X >= 0) {
        const best = findClosestUnused(numItems, h100X, 30, usedItems)
        if (best) { h100 = parseFloat(best.text.replace(/[(),]/g, '')) || 0; usedItems.add(best) }
      }

      if (h100 === 0 && h125 === 0 && h150 === 0) continue

      rows.push({ name, employee_number: empNum, date: isoDate, hours_100: h100, hours_125: h125, hours_150: h150 })
    }
  }

  // ─── Step 3: Debug output ───
  const uniqueEmps = new Set(rows.map(r => r.name)).size
  console.log(`[parseTimeWatch] Total: ${rows.length} rows for ${uniqueEmps} employees`)
  if (rows.length > 0) {
    console.log('[parseTimeWatch] Sample row:', rows[0])
  }

  return rows
}

function findClosestUnused(items: TextItem[], targetX: number, maxDist: number, used: Set<TextItem>): TextItem | null {
  let best: TextItem | null = null
  let bestDist = maxDist + 1
  for (const it of items) {
    if (used.has(it)) continue
    const dist = Math.abs(it.x - targetX)
    if (dist < bestDist) {
      const val = parseFloat(it.text.replace(/[(),]/g, ''))
      if (!isNaN(val) && val >= 0 && val <= 24) {
        bestDist = dist
        best = it
      }
    }
  }
  return best
}

/**
 * Fallback: parse without header positions.
 * Uses the known TimeWatch column order.
 * Numbers in each data row sorted by X ascending (leftmost first in PDF):
 * ... | ש.נ 150% | ש.נ 125% | רגילות | תקן | שעות עבודה | הפסקה | נוכחות | ... | times | ... | empNum
 *
 * So from the LEFT, after filtering out large numbers (>24) and times:
 * The first few numbers ≤24 are the overtime/regular hours.
 */
function parseTimeWatchFallback(allPages: { page: number; items: TextItem[] }[]): TimeWatchRow[] {
  const rows: TimeWatchRow[] = []

  for (const { items } of allPages) {
    const lines = groupIntoLines(items, 4)

    for (const line of lines) {
      const fullText = line.map(it => it.text).join(' ')

      const dateMatch = fullText.match(/(\d{2}-\d{2}-\d{4})/)
      if (!dateMatch) continue
      const isoDate = convertDate(dateMatch[1])
      if (!isoDate) continue
      if (fullText.includes('שם העובד') || fullText.includes('לתשומת') ||
          fullText.includes('TimeWatch') || fullText.includes('דוח נוכחות')) continue

      // Find name
      const byXDesc = [...line].sort((a, b) => b.x - a.x)
      let name = ''
      let empNum = ''
      const skipWords = new Set(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
        'עבודה', 'ייצור', 'הפסקה', 'מחלה', 'חסרה', 'כניסה', 'יציאה', 'תשלום',
        'ללא', 'בתשלום', 'יום', 'א', 'ב', 'ג', 'ד', 'ה', 'ו'])

      for (const it of byXDesc) {
        if (name && empNum) break
        if (!name && /[\u0590-\u05FF]/.test(it.text) && it.text.length > 1 && !skipWords.has(it.text) && !it.text.includes('+')) {
          name = it.text
          continue
        }
        if (!name && /^[A-Z][A-Z\s]{3,}/.test(it.text)) {
          name = it.text
          continue
        }
        if (name && !empNum && /^\d{1,4}$/.test(it.text)) {
          empNum = it.text
        }
      }
      if (!name) continue

      // Get hour-range numbers sorted by X ascending (leftmost first)
      const hourNums = line
        .filter(it => {
          if (it.text.includes(':')) return false // times
          const clean = it.text.replace(/[(),]/g, '')
          if (!/^\d+\.?\d*$/.test(clean)) return false
          const v = parseFloat(clean)
          return v >= 0 && v <= 24
        })
        .sort((a, b) => a.x - b.x)
        .map(it => ({ val: parseFloat(it.text.replace(/[(),]/g, '')), x: it.x }))

      if (hourNums.length === 0) continue

      // The leftmost numbers are overtime, then regular hours, then standard, then work hours, then attendance
      // Pattern: [150%, 125%, רגילות, תקן, עבודה, נוכחות] from left
      // Most rows have: [h125?, h100, תקן, עבודה, (הפסקה), נוכחות]
      // We need h100 which is the "רגילות" column

      // Find the pair where two adjacent numbers are equal (תקן = רגילות when no overtime on regular hours)
      // Or use the fact that שעות עבודה >= שעות רגילות and שעות תקן is usually 7 or 8

      // Simple heuristic: take numbers from the LEFT
      let h100 = 0, h125 = 0, h150 = 0
      if (hourNums.length >= 1) {
        // Just take the first few from the left as overtime/regular
        // This is unreliable without header positions, so we do our best
        const vals = hourNums.map(h => h.val)
        // Find 7.00 (standard hours) - the most common תקן value
        const standardIdx = vals.findIndex(v => v === 7 || v === 8)
        if (standardIdx >= 1) {
          // Regular hours is just before standard
          h100 = vals[standardIdx - 1] || 0
          // Overtime is before that
          h125 = standardIdx >= 2 ? vals[standardIdx - 2] : 0
          h150 = standardIdx >= 3 ? vals[standardIdx - 3] : 0
        } else {
          // Can't find standard, just take first value as h100
          h100 = vals[0] || 0
        }
      }

      if (h100 === 0 && h125 === 0 && h150 === 0) continue

      rows.push({ name, employee_number: empNum, date: isoDate, hours_100: h100, hours_125: h125, hours_150: h150 })
    }
  }

  return rows
}
