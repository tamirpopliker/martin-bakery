// ═══════════════════════════════════════════════════════════════════════════
// Reconcile register_closings entries against a CashOnTab PDF
// ═══════════════════════════════════════════════════════════════════════════
// Inputs:
//   - posRows:    one row per date from parseCashOnTabPDF — total NET amount
//                 across all registers for that branch + total transactions
//   - appRows:    register_closings rows from Supabase for the same branch +
//                 period (any number of registers per date)
//
// Output: one DiffRow per date in the union of the two ranges, classified into
//   match / amountDiff / countDiff / both / missingApp / missingPos / shabbat
// so the UI can color and filter.
// ═══════════════════════════════════════════════════════════════════════════

import type { CashOnTabRow } from './parseCashOnTab'

export type ReconStatus =
  | 'match'         // all fields within tolerance
  | 'amount_diff'   // sum differs > tolerance
  | 'count_diff'    // tx count differs
  | 'both_diff'     // both amount and count differ
  | 'missing_app'   // POS has data, app has nothing
  | 'missing_pos'   // app has data, POS has nothing
  | 'shabbat'       // Saturday — closed, no data expected

export interface AppClosing {
  date: string         // YYYY-MM-DD
  register_number: number
  cash_sales: number   // NET
  credit_sales: number // NET
  transaction_count: number
}

export interface DiffRow {
  date: string                  // YYYY-MM-DD
  status: ReconStatus
  posAmount: number | null      // net
  posTransactions: number | null
  appAmount: number | null      // sum across registers (NET cash + credit)
  appCash: number | null
  appCredit: number | null
  appTransactions: number | null
  amountDelta: number | null    // app - pos
  txDelta: number | null        // app - pos
  appRegisters: AppClosing[]    // per-register breakdown from app side
}

const AMOUNT_TOLERANCE = 1     // ₪1 — absorbs VAT rounding
const TX_TOLERANCE = 0          // tx count must match exactly

function isShabbat(dateISO: string): boolean {
  // JS Date.getDay(): 0 = Sunday, 6 = Saturday
  return new Date(dateISO + 'T12:00:00').getDay() === 6
}

function classify(posAmount: number | null, posTx: number | null, appAmount: number | null, appTx: number | null, dateISO: string): ReconStatus {
  if (isShabbat(dateISO) && posAmount === null && appAmount === null) return 'shabbat'
  if (posAmount === null && appAmount === null) return 'shabbat' // treat as no-data day
  if (posAmount !== null && appAmount === null) return 'missing_app'
  if (posAmount === null && appAmount !== null) return 'missing_pos'

  const amtOk = Math.abs((posAmount || 0) - (appAmount || 0)) <= AMOUNT_TOLERANCE
  const txOk  = Math.abs((posTx || 0) - (appTx || 0)) <= TX_TOLERANCE
  if (amtOk && txOk) return 'match'
  if (!amtOk && !txOk) return 'both_diff'
  if (!amtOk) return 'amount_diff'
  return 'count_diff'
}

function buildDateRange(fromISO: string, toISO: string): string[] {
  const dates: string[] = []
  const d = new Date(fromISO + 'T12:00:00')
  const end = new Date(toISO + 'T12:00:00') // toISO exclusive
  while (d < end) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    dates.push(iso)
    d.setDate(d.getDate() + 1)
  }
  return dates
}

export function reconcile(
  posRows: CashOnTabRow[],
  appRows: AppClosing[],
  fromISO: string,
  toISO: string,
): DiffRow[] {
  // Index POS by date
  const posByDate = new Map<string, CashOnTabRow>()
  for (const r of posRows) posByDate.set(r.date, r)

  // Group app rows by date and sum
  const appByDate = new Map<string, { cash: number; credit: number; tx: number; rows: AppClosing[] }>()
  for (const r of appRows) {
    const slot = appByDate.get(r.date) || { cash: 0, credit: 0, tx: 0, rows: [] }
    slot.cash += Number(r.cash_sales || 0)
    slot.credit += Number(r.credit_sales || 0)
    slot.tx += Number(r.transaction_count || 0)
    slot.rows.push(r)
    appByDate.set(r.date, slot)
  }

  // Date range = union of fromISO..toISO + any dates outside the range that
  // appear in either source. The page passes a period range so usually the
  // union just equals the period.
  const allDates = new Set<string>(buildDateRange(fromISO, toISO))
  for (const d of posByDate.keys()) allDates.add(d)
  for (const d of appByDate.keys()) allDates.add(d)

  const sorted = [...allDates].sort().reverse() // newest first
  return sorted.map((date): DiffRow => {
    const pos = posByDate.get(date) || null
    const app = appByDate.get(date) || null
    const posAmount = pos ? pos.amount : null
    const posTx = pos ? pos.transactions : null
    const appAmount = app ? Math.round((app.cash + app.credit) * 100) / 100 : null
    const appTx = app ? app.tx : null
    const status = classify(posAmount, posTx, appAmount, appTx, date)
    return {
      date,
      status,
      posAmount,
      posTransactions: posTx,
      appAmount,
      appCash: app ? Math.round(app.cash * 100) / 100 : null,
      appCredit: app ? Math.round(app.credit * 100) / 100 : null,
      appTransactions: appTx,
      amountDelta: posAmount !== null && appAmount !== null ? Math.round((appAmount - posAmount) * 100) / 100 : null,
      txDelta: posTx !== null && appTx !== null ? (appTx - posTx) : null,
      appRegisters: app ? app.rows.slice().sort((a, b) => a.register_number - b.register_number) : [],
    }
  })
}

export const STATUS_LABEL: Record<ReconStatus, string> = {
  match: 'תואם',
  amount_diff: 'פער סכום',
  count_diff: 'פער עסקאות',
  both_diff: 'פער סכום + עסקאות',
  missing_app: 'לא הוזן באפליקציה',
  missing_pos: 'אין בקובץ',
  shabbat: 'שבת',
}

export const STATUS_STYLE: Record<ReconStatus, { bg: string; color: string }> = {
  match:       { bg: '#dcfce7', color: '#166534' },
  amount_diff: { bg: '#fef3c7', color: '#92400e' },
  count_diff:  { bg: '#fef3c7', color: '#92400e' },
  both_diff:   { bg: '#fef3c7', color: '#92400e' },
  missing_app: { bg: '#fee2e2', color: '#991b1b' },
  missing_pos: { bg: '#ffedd5', color: '#9a3412' },
  shabbat:     { bg: '#f1f5f9', color: '#64748b' },
}
