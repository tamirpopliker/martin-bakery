/**
 * CashOnTab PDF Parser
 *
 * Parses "השוואת מכירות - יומי" reports from CashOnTab POS system.
 * Extracts: date, amount (ללא מע"מ), transactions count.
 *
 * PDF row format (RTL):
 *   ממוצע | כמות מסמכים | סה"כ מע"מ | סה"כ ללא מע"מ | סה"כ כולל מע"מ | תאריך
 *   37.14    236          1,337.10     7,427.87         8,764.97         15/03/26
 */

import * as pdfjsLib from 'pdfjs-dist'

// Use bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

export interface CashOnTabRow {
  date: string        // YYYY-MM-DD
  amount: number      // סה"כ ללא מע"מ
  transactions: number // כמות מסמכים
}

/**
 * Parse a number string like "7,427.87" or "361.85" into a float
 */
function parseNumber(s: string): number {
  const cleaned = s.replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

/**
 * Convert DD/MM/YY to YYYY-MM-DD
 * e.g. "15/03/26" → "2026-03-15"
 */
function parseDate(s: string): string | null {
  const match = s.match(/^(\d{1,2})\/(\d{2})\/(\d{2})$/)
  if (!match) return null
  const day = match[1].padStart(2, '0')
  const month = match[2]
  const year = '20' + match[3]
  // Validate
  const d = new Date(`${year}-${month}-${day}T12:00:00`)
  if (isNaN(d.getTime())) return null
  return `${year}-${month}-${day}`
}

/**
 * Main parser: reads a CashOnTab PDF file and extracts daily sales rows.
 */
export async function parseCashOnTabPDF(file: File): Promise<CashOnTabRow[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const rows: CashOnTabRow[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const textContent = await page.getTextContent()

    // Extract all text items with their positions
    const items = textContent.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        text: item.str.trim(),
        x: Math.round(item.transform[4]),
        y: Math.round(item.transform[5]),
      }))

    // Group items by Y position (same row = within 3px)
    const yGroups: Record<number, typeof items> = {}
    for (const item of items) {
      const yKey = Object.keys(yGroups).find(k => Math.abs(Number(k) - item.y) < 3)
      if (yKey) {
        yGroups[Number(yKey)].push(item)
      } else {
        yGroups[item.y] = [item]
      }
    }

    // Process each row
    for (const [, groupItems] of Object.entries(yGroups)) {
      // Sort by X position (right to left for RTL — highest X first = rightmost)
      const sorted = [...groupItems].sort((a, b) => b.x - a.x)
      const texts = sorted.map(i => i.text)

      // Find the date token (DD/MM/YY format)
      const dateIdx = texts.findIndex(t => /^\d{1,2}\/\d{2}\/\d{2}$/.test(t))
      if (dateIdx === -1) continue

      const dateStr = parseDate(texts[dateIdx])
      if (!dateStr) continue

      // Extract all number tokens from this row (excluding the date)
      const numbers = texts
        .filter((_, i) => i !== dateIdx)
        .map(t => t.replace(/,/g, ''))
        .filter(t => /^\d+(\.\d+)?$/.test(t))
        .map(parseFloat)

      // CashOnTab format has 5 numbers per row:
      // [total_with_vat, total_no_vat, total_vat, transactions, average]
      // Sorted by X descending (rightmost first), date is rightmost, then:
      // total_with_vat > total_no_vat > total_vat > transactions > average
      if (numbers.length < 4) continue

      // Sort numbers descending to identify them by magnitude
      // total_with_vat is largest, then total_no_vat, then total_vat
      // transactions is an integer (no decimal typically), average is small
      const sortedNums = [...numbers].sort((a, b) => b - a)

      // The second largest number is "סה"כ ללא מע"מ" (total without VAT)
      const amountNoVat = sortedNums[1]

      // Find transactions: integer, typically between 1 and 999, not a money amount
      // It's the number that when multiplied by average ≈ total_with_vat
      let transactions = 0
      for (const n of numbers) {
        if (n === Math.floor(n) && n >= 1 && n < 1000 && n !== amountNoVat && n !== sortedNums[0]) {
          // This is likely the transaction count
          transactions = n
          break
        }
      }

      if (amountNoVat <= 0) continue

      rows.push({
        date: dateStr,
        amount: Math.round(amountNoVat * 100) / 100,
        transactions,
      })
    }
  }

  // Sort by date ascending
  rows.sort((a, b) => a.date.localeCompare(b.date))

  // Deduplicate by date (in case of multi-page overlap)
  const unique = new Map<string, CashOnTabRow>()
  for (const row of rows) {
    if (!unique.has(row.date)) {
      unique.set(row.date, row)
    }
  }

  return [...unique.values()]
}
