/**
 * Fabios Delivery Note PDF Parser
 *
 * Parses תעודת משלוח PDFs produced by the factory POS (Fabios).
 * Layout (RTL Hebrew):
 *   תעודת משלוח מס' 6593
 *   לידי: מרטין - <branch>
 *   מס' לקוח: 400
 *   תאריך: יום א׳ 14/06/2026
 *   ...
 *   מוצר | מק"ט | כמות | מחיר | הנחה | סה"כ
 *   מילפה פטיסייר חלבי   יח'   55 יחידות   5.094   280.142
 *   ...
 *   סה"כ מחיר לא כולל מע"מ: 319.06
 *   הנחה (15%): 47.86
 *   מחיר לאחר הנחה 271.2
 *   מע"מ: 48.82
 *   סה"כ מחיר כולל מע"מ: 320.02
 *
 * The order-level discount (if present) is distributed proportionally
 * across items so that internal_sales.total_amount matches the
 * post-discount, pre-VAT amount printed on the doc.
 */

import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

export interface ParsedDeliveryItem {
  product_name: string
  quantity: number
  unit_price: number   // after order-level discount distributed
  total_price: number  // after order-level discount distributed
}

export interface ParsedDeliveryNote {
  orderNumber: string | null
  orderDate: string | null    // YYYY-MM-DD
  branchHint: string | null   // text after "לידי: מרטין - "
  items: ParsedDeliveryItem[]
  zeroItems: string[]         // names of products dropped due to qty=0
  discountPct: number         // 0 if none
  totalPreDiscount: number    // sum of raw item totals before discount
  rawLines: string[]          // for debugging
}

interface TextItem { text: string; x: number; y: number }

function groupIntoLines(items: TextItem[], tolerance = 3): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || b.x - a.x)
  const lines: TextItem[][] = []
  for (const item of sorted) {
    const existing = lines.find(l => Math.abs(l[0].y - item.y) <= tolerance)
    if (existing) existing.push(item)
    else lines.push([item])
  }
  // Within each line — RTL reading order = sort by x descending
  for (const line of lines) line.sort((a, b) => b.x - a.x)
  return lines
}

function lineText(line: TextItem[]): string {
  return line.map(it => it.text).join(' ').replace(/\s+/g, ' ').trim()
}

function parseNum(s: string): number {
  return Number(s.replace(/[^\d.-]/g, ''))
}

export async function parseDeliveryNotePDF(file: File): Promise<ParsedDeliveryNote> {
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise

  // Build lines PER PAGE then concatenate. pdfjs gives each page its own
  // y-coordinate space (origin = bottom-left of that page), so a global
  // y-sort jumbles items from different pages — page 1 line at y=400 would
  // be grouped with a page 2 line at y=400, breaking everything.
  const rawLines: string[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    const pageItems: TextItem[] = []
    for (const it of (content.items as any[])) {
      if (!it.str?.trim()) continue
      pageItems.push({
        text: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
      })
    }
    for (const line of groupIntoLines(pageItems, 3)) {
      const t = lineText(line)
      if (t) rawLines.push(t)
    }
  }

  if (typeof window !== 'undefined' && (window as any).__DELIVERY_PDF_DEBUG__) {
    console.log('[parseDeliveryNotePDF] rawLines:', rawLines)
  }

  let orderNumber: string | null = null
  let orderDate: string | null = null
  let branchHint: string | null = null
  let discountPct = 0
  const items: ParsedDeliveryItem[] = []
  const zeroItems: string[] = []

  let inItemsTable = false

  for (const text of rawLines) {
    if (!text) continue

    if (orderNumber == null) {
      const m = text.match(/תעודת\s*משלוח\s*מס'?\s*(\d+)/) || text.match(/מס'?\s+(\d{3,})/)
      if (m) orderNumber = m[1]
    }

    if (branchHint == null && /לידי/.test(text)) {
      // Accept "מרטין - X", "מרטין- X", "מרטין -X", "מרטין X". Capture the
      // suffix and strip an optional "מרטין" prefix + dash. RTL text from
      // pdfjs occasionally keeps the dash attached to "מרטין" with no space.
      const m = text.match(/לידי:?\s*(.+?)\s*$/)
      if (m) {
        const name = m[1].replace(/^מרטין\s*[-–]?\s*/, '').trim()
        if (name) branchHint = name
      }
    }

    if (orderDate == null && text.includes('תאריך')) {
      const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
      if (m) {
        const dd = m[1].padStart(2, '0')
        const mm = m[2].padStart(2, '0')
        orderDate = `${m[3]}-${mm}-${dd}`
      }
    }

    if (text.includes('הנחה') && text.includes('%')) {
      const m = text.match(/(\d+(?:\.\d+)?)\s*%/)
      if (m) discountPct = Number(m[1])
    }

    // Items table boundary detection
    if (text.includes('מוצר') && text.includes('כמות') && text.includes('מחיר')) {
      inItemsTable = true
      continue
    }
    if (inItemsTable && (text.includes('לא כולל מע') || /^סה['"]?כ\s*מחיר/.test(text))) {
      inItemsTable = false
    }

    if (inItemsTable) {
      // Expected layout: <product> <qty> <unit> <unit_price> [<line_discount>] <total>
      // Units seen so far: "יחידות", "ק"ג", "ארגז" (and pdfjs sometimes splits
      // ק"ג into separate tokens around the quote). The robust strategy:
      // walk from the end — collect trailing numbers, the next non-number
      // token(s) are the unit, the number before that is the qty.
      const tokens = text.split(/\s+/)
      const isNumTok = (t: string) => /^-?\d/.test(t.replace(/,/g, ''))

      let i = tokens.length - 1
      const trailingNums: number[] = []
      while (i >= 0 && isNumTok(tokens[i])) {
        trailingNums.unshift(parseNum(tokens[i]))
        i--
      }
      if (trailingNums.length < 2) continue

      // Skip over the unit word(s) — there can be 1+ non-number tokens here
      // (e.g. "ק"ג" split as ק / " / ג depending on pdfjs).
      while (i >= 0 && !isNumTok(tokens[i])) i--
      if (i < 0) continue

      const qty = parseNum(tokens[i])
      if (!Number.isFinite(qty)) continue

      // 2 trailing nums = [price, total]; 3 = [price, discount, total]; 4+ = pick
      // first as price and last as total (safest given known formats).
      const unit_price = trailingNums[0]
      const total = trailingNums[trailingNums.length - 1]

      const product_name = tokens.slice(0, i).join(' ').replace(/\s+/g, ' ').trim()
      if (!product_name) continue

      if (qty === 0) { zeroItems.push(product_name); continue }
      items.push({ product_name, quantity: qty, unit_price, total_price: total })
    }
  }

  const totalPreDiscount = items.reduce((s, i) => s + i.total_price, 0)

  // Distribute the order-level discount proportionally so the saved totals
  // match what accounting sees on the printed PDF.
  if (discountPct > 0) {
    const factor = 1 - discountPct / 100
    for (const item of items) {
      const newTotal = Math.round(item.total_price * factor * 100) / 100
      item.total_price = newTotal
      item.unit_price = item.quantity > 0
        ? Math.round((newTotal / item.quantity) * 1000) / 1000
        : 0
    }
  }

  return {
    orderNumber,
    orderDate,
    branchHint,
    items,
    zeroItems,
    discountPct,
    totalPreDiscount,
    rawLines,
  }
}
