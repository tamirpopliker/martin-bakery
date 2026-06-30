// ═══════════════════════════════════════════════════════════════════════════
// Reconcile register_closings entries against the CashOnTab Excel
// ═══════════════════════════════════════════════════════════════════════════
// Join per (date, register_number). CashOnTab .xlsx exports one row per
// register per day with cash + credit split, so we compare each pair directly
// instead of summing across registers like the older daily PDF did.
// ═══════════════════════════════════════════════════════════════════════════

import type { PosClosingRow } from './parseCashOnTabExcel'

export type ReconStatus =
  | 'match'         // cash + credit both within tolerance
  | 'cash_diff'     // cash differs
  | 'credit_diff'   // credit differs
  | 'both_diff'     // both differ
  | 'missing_app'   // POS has row, app has no closing for (date, register)
  | 'missing_pos'   // app has closing, POS file has no matching row

export interface AppClosing {
  date: string         // YYYY-MM-DD
  register_number: number
  cash_sales: number   // NET
  credit_sales: number // NET
  transaction_count: number
}

export interface DiffRow {
  date: string
  register_number: number
  status: ReconStatus
  // NET values for comparison
  posCash: number | null
  posCredit: number | null
  posTotal: number | null
  appCash: number | null
  appCredit: number | null
  appTotal: number | null
  cashDelta: number | null    // app - pos
  creditDelta: number | null
  totalDelta: number | null
  // Extras
  appTransactions: number | null
  posGrossTotal: number | null  // for the user to see the raw gross from POS
}

const AMOUNT_TOLERANCE = 1  // ₪1 absorbs rounding from VAT division

function classify(
  posCash: number | null, posCredit: number | null,
  appCash: number | null, appCredit: number | null,
): ReconStatus {
  if (posCash === null && posCredit === null && appCash !== null) return 'missing_pos'
  if (appCash === null && appCredit === null && posCash !== null) return 'missing_app'
  const cashOk = Math.abs((posCash || 0) - (appCash || 0)) <= AMOUNT_TOLERANCE
  const credOk = Math.abs((posCredit || 0) - (appCredit || 0)) <= AMOUNT_TOLERANCE
  if (cashOk && credOk) return 'match'
  if (!cashOk && !credOk) return 'both_diff'
  if (!cashOk) return 'cash_diff'
  return 'credit_diff'
}

function round2(n: number) { return Math.round(n * 100) / 100 }

export function reconcile(
  posRows: PosClosingRow[],
  appRows: AppClosing[],
): DiffRow[] {
  const posByKey = new Map<string, PosClosingRow>()
  for (const r of posRows) posByKey.set(`${r.date}|${r.register_number}`, r)

  const appByKey = new Map<string, AppClosing>()
  for (const r of appRows) appByKey.set(`${r.date}|${r.register_number}`, r)

  const allKeys = new Set<string>([...posByKey.keys(), ...appByKey.keys()])

  const rows: DiffRow[] = []
  for (const key of allKeys) {
    const [date, regStr] = key.split('|')
    const register_number = Number(regStr)
    const pos = posByKey.get(key) || null
    const app = appByKey.get(key) || null

    const posCash = pos ? pos.cash : null
    const posCredit = pos ? pos.credit : null
    const posTotal = pos ? pos.total : null
    const appCash = app ? Number(app.cash_sales) : null
    const appCredit = app ? Number(app.credit_sales) : null
    const appTotal = app ? Number(app.cash_sales) + Number(app.credit_sales) : null

    rows.push({
      date,
      register_number,
      status: classify(posCash, posCredit, appCash, appCredit),
      posCash, posCredit, posTotal,
      appCash: appCash === null ? null : round2(appCash),
      appCredit: appCredit === null ? null : round2(appCredit),
      appTotal: appTotal === null ? null : round2(appTotal),
      cashDelta: posCash !== null && appCash !== null ? round2(appCash - posCash) : null,
      creditDelta: posCredit !== null && appCredit !== null ? round2(appCredit - posCredit) : null,
      totalDelta: posTotal !== null && appTotal !== null ? round2(appTotal - posTotal) : null,
      appTransactions: app ? app.transaction_count : null,
      posGrossTotal: pos ? pos.totalGross : null,
    })
  }

  rows.sort((a, b) => b.date.localeCompare(a.date) || a.register_number - b.register_number)
  return rows
}

export const STATUS_LABEL: Record<ReconStatus, string> = {
  match: 'תואם',
  cash_diff: 'פער מזומן',
  credit_diff: 'פער אשראי',
  both_diff: 'פער מזומן + אשראי',
  missing_app: 'לא הוזן באפליקציה',
  missing_pos: 'אין בקובץ',
}

export const STATUS_STYLE: Record<ReconStatus, { bg: string; color: string }> = {
  match:       { bg: '#dcfce7', color: '#166534' },
  cash_diff:   { bg: '#fef3c7', color: '#92400e' },
  credit_diff: { bg: '#fef3c7', color: '#92400e' },
  both_diff:   { bg: '#fef3c7', color: '#92400e' },
  missing_app: { bg: '#fee2e2', color: '#991b1b' },
  missing_pos: { bg: '#ffedd5', color: '#9a3412' },
}
