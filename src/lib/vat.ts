/**
 * VAT — single source of truth (Israel, 18% from Jan 2025).
 *
 * Do not redeclare 0.18 / 1.18 anywhere else. If the rate ever changes, change
 * it here only.
 *
 *   net  = gross / VAT_DIVIDER
 *   gross = net * VAT_DIVIDER
 */
export const VAT_RATE = 0.18
export const VAT_DIVIDER = 1 + VAT_RATE // 1.18
