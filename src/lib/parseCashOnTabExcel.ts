// ═══════════════════════════════════════════════════════════════════════════
// CashOnTab Excel Parser — daily closing report (one row per register, per day)
// ═══════════════════════════════════════════════════════════════════════════
// Expected columns in the CashOnTab .xlsx export:
//   D — קוד קופה          (register_number)
//   H — תאריך סגירה       (date — Excel serial or DD/MM/YYYY string)
//   J — מספר Z             (Z report number, for cross-referencing the paper Z)
//   K — סה"כ תקבולים      (total receipts, GROSS, with VAT)
//   L — סה"כ מזומן         (cash total, GROSS)
//   N — סה"כ אשראי         (credit total, GROSS)
//
// Returns rows in NET (no VAT) so they match register_closings storage.
// Conversion: net = gross / (1 + VAT_RATE)
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx'

const VAT_RATE = 0.18
const VAT_DIVIDER = 1 + VAT_RATE

export interface PosClosingRow {
  date: string             // YYYY-MM-DD
  register_number: number
  z_number: number | null  // CashOnTab Z report number (column J)
  total: number            // NET
  cash: number             // NET
  credit: number           // NET
  totalGross: number       // GROSS — preserved for user transparency
  cashGross: number
  creditGross: number
}

// ─── helpers ──────────────────────────────────────────────────────────────

function cellNumber(cell: any): number {
  if (!cell) return 0
  if (typeof cell.v === 'number') return cell.v
  const s = String(cell.v ?? '').trim().replace(/,/g, '').replace(/[₪\s]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function cellRegister(cell: any): number | null {
  if (!cell) return null
  if (typeof cell.v === 'number' && Number.isInteger(cell.v)) return cell.v
  const s = String(cell.v ?? '').trim()
  const m = s.match(/^\d+/)
  return m ? Number(m[0]) : null
}

function cellDate(cell: any): string | null {
  if (!cell) return null
  // Excel serial date
  if (typeof cell.v === 'number') {
    const d = XLSX.SSF.parse_date_code(cell.v)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  // String — try DD/MM/YYYY or DD/MM/YY or YYYY-MM-DD
  const s = String(cell.v ?? '').trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) {
    const day = m[1].padStart(2, '0')
    const month = m[2].padStart(2, '0')
    let year = m[3]
    if (year.length === 2) year = '20' + year
    return `${year}-${month}-${day}`
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return null
}

// ─── main ─────────────────────────────────────────────────────────────────

export async function parseCashOnTabExcel(file: File): Promise<PosClosingRow[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws || !ws['!ref']) return []

  const range = XLSX.utils.decode_range(ws['!ref'])
  const out: PosClosingRow[] = []

  // Iterate every row. Accept any row whose D and H are both valid.
  for (let r = range.s.r; r <= range.e.r; r++) {
    const dCell = ws[XLSX.utils.encode_cell({ c: 3, r })]   // D
    const hCell = ws[XLSX.utils.encode_cell({ c: 7, r })]   // H
    const jCell = ws[XLSX.utils.encode_cell({ c: 9, r })]   // J — Z number
    const kCell = ws[XLSX.utils.encode_cell({ c: 10, r })]  // K
    const lCell = ws[XLSX.utils.encode_cell({ c: 11, r })]  // L
    const nCell = ws[XLSX.utils.encode_cell({ c: 13, r })]  // N

    const reg = cellRegister(dCell)
    const date = cellDate(hCell)
    if (reg === null || !date) continue

    const z_number = cellRegister(jCell)  // same heuristic — integer-leading value
    const totalGross = cellNumber(kCell)
    const cashGross = cellNumber(lCell)
    const creditGross = cellNumber(nCell)

    // Skip rows where everything is 0 — likely subtotal/footer noise that
    // happened to have a date and register but no monetary values.
    if (totalGross === 0 && cashGross === 0 && creditGross === 0) continue

    out.push({
      date,
      register_number: reg,
      z_number,
      total: Math.round((totalGross / VAT_DIVIDER) * 100) / 100,
      cash: Math.round((cashGross / VAT_DIVIDER) * 100) / 100,
      credit: Math.round((creditGross / VAT_DIVIDER) * 100) / 100,
      totalGross,
      cashGross,
      creditGross,
    })
  }

  // Deduplicate by (date, register_number) — keep the row with the largest
  // total in case the file has both detail + summary lines.
  const byKey = new Map<string, PosClosingRow>()
  for (const row of out) {
    const key = `${row.date}|${row.register_number}`
    const prev = byKey.get(key)
    if (!prev || row.total > prev.total) byKey.set(key, row)
  }
  return [...byKey.values()].sort((a, b) =>
    b.date.localeCompare(a.date) || a.register_number - b.register_number
  )
}
