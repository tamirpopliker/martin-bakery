/**
 * Shared helpers for wrapping Supabase write operations so callers can surface
 * the error to the user instead of silently reporting success.
 *
 * Background: prior to 2026-04-21 the vast majority of mutation calls ignored
 * the `error` field returned by Supabase. When RLS denied a write, a
 * constraint tripped, or the network flapped, the UI still advanced to the
 * "saved" state and the record never landed in the DB. See REVIEW_2026_04_20.md
 * §3.5 for the trail.
 */

export type DbResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Run a Supabase write and normalise the result to a `DbResult`.
 *
 * `operation` must be a function that returns the usual `{ data, error }` —
 * pass it a lambda so the await inside this helper sees a single awaitable:
 *
 *     const res = await safeDbOperation(
 *       () => supabase.from('foo').insert(row).select().single(),
 *       'יצירת רשומה'
 *     )
 *     if (!res.ok) { setError(res.error); return }
 *
 * `userFriendlyContext` is a short Hebrew phrase describing the action. It is
 * used both in the returned message and in the console log. Prefer natural
 * phrases over technical names ("שמירת הזמנה" — not "insert orders").
 *
 * The helper deliberately does NOT treat `data === null` as an error by
 * default — some valid Supabase calls (e.g. `.delete()`, `.update()` without
 * `.select()`) return null data. Callers that require a row should either add
 * `.select().single()` to the query or check `res.data` themselves.
 */
// `PromiseLike` — Supabase builders are thenable (they execute on await)
// but their TypeScript type is not a native `Promise`, so we accept the
// wider PromiseLike interface here.
//
// The `data` field in `DbResult.ok` is `NonNullable<T>` — after a successful
// operation that the caller marked `requireData: true`, we narrow away null.
// For calls without `requireData`, callers should treat `data` as possibly
// null (e.g. `.delete()` returns null data even on success).
export async function safeDbOperation<T>(
  operation: () => PromiseLike<{ data: T | null; error: any }>,
  userFriendlyContext: string,
  opts?: { requireData?: boolean }
): Promise<DbResult<NonNullable<T>>> {
  try {
    const { data, error } = await operation()
    if (error) {
      console.error(`[${userFriendlyContext}] DB error:`, error)
      return {
        ok: false,
        error: `${userFriendlyContext} נכשל: ${humanizeError(error)}`,
      }
    }
    if (opts?.requireData && (data === null || data === undefined)) {
      return { ok: false, error: `${userFriendlyContext} נכשל: לא התקבלו נתונים` }
    }
    return { ok: true, data: data as NonNullable<T> }
  } catch (e: any) {
    console.error(`[${userFriendlyContext}] Exception:`, e)
    return {
      ok: false,
      error: `${userFriendlyContext} נכשל: ${e?.message || 'שגיאה לא צפויה'}`,
    }
  }
}

/**
 * Translate common Postgres / PostgREST errors into short Hebrew phrases.
 * Falls back to the raw message when no specific match is found.
 */
function humanizeError(err: any): string {
  const msg = String(err?.message || err || '')
  const code = String(err?.code || '')

  // RLS / permission denied
  if (code === '42501' || /permission|policy|rls/i.test(msg)) {
    return 'אין הרשאה לבצע פעולה זו'
  }
  // Unique violation
  if (code === '23505' || /duplicate|unique/i.test(msg)) {
    return 'הרשומה כבר קיימת'
  }
  // Foreign key violation
  if (code === '23503' || /foreign key/i.test(msg)) {
    return 'רשומה קשורה חסרה או שונתה'
  }
  // Not null / check violation
  if (code === '23502' || /not[- ]null/i.test(msg)) {
    return 'חסר שדה חובה'
  }
  if (code === '23514' || /check constraint/i.test(msg)) {
    return 'ערך לא חוקי'
  }
  // Network / fetch
  if (/failed to fetch|networkerror|timeout/i.test(msg)) {
    return 'בעיית תקשורת. נסה שוב בעוד מספר שניות'
  }
  return msg || 'שגיאת מסד נתונים'
}
