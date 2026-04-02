/**
 * CashOnTab PDF Parser
 *
 * Parses "השוואת מכירות - יומי" reports from CashOnTab POS system.
 * Extracts: date, amount (ללא מע"מ), transactions count.
 *
 * PDF text line format (extracted as single string per row):
 *   61.00 7 65.15 361.85 427.00 13/03/26
 *   37.14 236 1,337.10 7,427.87 8,764.97 15/03/26
 *
 * Numbers appear in order: average, transactions, vat, noVat, withVat, date
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export interface CashOnTabRow {
  date: string        // YYYY-MM-DD
  amount: number      // סה"כ ללא מע"מ
  transactions: number // כמות מסמכים
}

/**
 * Convert DD/MM/YY to YYYY-MM-DD
 */
function convertDate(ddmmyy: string): string | null {
  const m = ddmmyy.match(/^(\d{1,2})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  const day = m[1].padStart(2, '0')
  const month = m[2]
  const year = '20' + m[3]
  const d = new Date(`${year}-${month}-${day}T12:00:00`)
  if (isNaN(d.getTime())) return null
  return `${year}-${month}-${day}`
}

/**
 * Main parser
 */
export async function parseCashOnTabPDF(file: File): Promise<CashOnTabRow[]> {
  const arrayBuffer = await file.arrayBuffer()

  let pdf: any
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
  } catch (err) {
    console.error('PDF load error:', err)
    return []
  }

  // Extract ALL text from all pages into one big string
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items.map((item: any) => item.str).join(' ')
    fullText += pageText + ' '
  }

  console.log('PDF full text:', fullText.substring(0, 500))

  const rows: CashOnTabRow[] = []

  // Strategy: find all date patterns DD/MM/YY and extract the numbers around them
  // The PDF text has numbers and dates in sequence. We'll find each date
  // and grab the 5 numbers that precede it.

  // Tokenize the full text
  const tokens = fullText.split(/\s+/).filter(t => t.length > 0)

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx]

    // Check if this token is a date DD/MM/YY
    if (!/^\d{1,2}\/\d{2}\/\d{2}$/.test(token)) continue

    const dateStr = convertDate(token)
    if (!dateStr) continue

    // Look backwards for numbers (up to 10 tokens back)
    const nums: number[] = []
    for (let j = idx - 1; j >= Math.max(0, idx - 10) && nums.length < 5; j--) {
      const cleaned = tokens[j].replace(/,/g, '')
      if (/^\d+(\.\d+)?$/.test(cleaned)) {
        nums.unshift(parseFloat(cleaned))
      }
    }

    // We expect 5 numbers: average, transactions, vat, noVat, withVat
    // But let's be flexible — at minimum we need 2 (noVat + transactions)
    if (nums.length < 2) continue

    // The numbers from the PDF text appear in this order (left to right):
    // average | transactions | vat | noVat | withVat
    // But since we collected backwards from the date, they are in natural order

    if (nums.length >= 5) {
      // Full row: [average, transactions, vat, noVat, withVat]
      const average = nums[0]
      const transactions = Math.round(nums[1])
      const vat = nums[2]
      const noVat = nums[3]
      const withVat = nums[4]

      // Validate: withVat should be the largest, noVat second
      // Also withVat ≈ noVat + vat
      if (noVat > 0 && withVat >= noVat) {
        rows.push({ date: dateStr, amount: Math.round(noVat * 100) / 100, transactions })
        continue
      }
    }

    // Fallback: sort numbers by size and take second largest as noVat
    if (nums.length >= 4) {
      const sorted = [...nums].sort((a, b) => b - a)
      const withVat = sorted[0]
      const noVat = sorted[1]
      // transactions is likely the integer that's not a money amount
      let transactions = 0
      for (const n of nums) {
        if (n === Math.floor(n) && n >= 1 && n < 2000 && n !== withVat && n !== noVat) {
          transactions = n
          break
        }
      }
      if (noVat > 0) {
        rows.push({ date: dateStr, amount: Math.round(noVat * 100) / 100, transactions })
      }
    }
  }

  // Sort by date
  rows.sort((a, b) => a.date.localeCompare(b.date))

  // Deduplicate
  const unique = new Map<string, CashOnTabRow>()
  for (const row of rows) {
    if (!unique.has(row.date)) unique.set(row.date, row)
  }

  const result = [...unique.values()]
  console.log('Parsed CashOnTab rows:', result)
  return result
}
