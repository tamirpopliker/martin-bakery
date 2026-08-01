/**
 * Dev-only query instrumentation. Wraps the Supabase client's `fetch` so every
 * PostgREST round-trip is counted and timed WITHOUT touching any of the ~750
 * call sites. Requests are grouped into "bursts" (a page load / period change
 * fires a burst of queries, then goes quiet); each burst is summarised to the
 * console so we get a real before/after baseline for the perf work.
 *
 * Zero production impact: only wired in when `import.meta.env.DEV`. Silence it
 * at runtime with `localStorage.qperf = 'off'`; re-enable with `= 'on'`.
 *
 * Read the burst summary like this:
 *   - "queries"      = network round-trips in the burst (the thing to reduce)
 *   - "wall"         = wall-clock from first request start to last response end
 *   - "sumMs"        = total time if the queries ran one-by-one (serial cost)
 *   - "parallelism"  = sumMs / wall. ~1 means fully sequential (waterfall);
 *                       higher means the queries overlapped (good).
 */

interface QueryRecord {
  table: string
  method: string
  ms: number
  status: number
}

const PERF_ENABLED = import.meta.env.DEV

let batch: QueryRecord[] = []
let batchStart = 0
let batchEndMax = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null

function enabled(): boolean {
  if (!PERF_ENABLED) return false
  try {
    return localStorage.getItem('qperf') !== 'off'
  } catch {
    return true
  }
}

function tableFromUrl(url: string): string {
  // .../rest/v1/branch_revenue?select=...  ->  branch_revenue
  // .../rest/v1/rpc/some_fn               ->  rpc:some_fn
  const m = url.match(/\/rest\/v1\/(rpc\/)?([^?]+)/)
  if (!m) return '(other)'
  return m[1] ? `rpc:${m[2]}` : m[2]
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  // A burst is "done" once no new query has started for 400ms.
  flushTimer = setTimeout(flush, 400)
}

function flush() {
  flushTimer = null
  const records = batch
  batch = []
  if (records.length === 0) return

  const wall = Math.round(batchEndMax - batchStart)
  const sumMs = Math.round(records.reduce((a, r) => a + r.ms, 0))
  const parallelism = wall > 0 ? (sumMs / wall).toFixed(1) : '—'

  // per-table breakdown, worst (most calls) first
  const byTable = new Map<string, { count: number; ms: number }>()
  for (const r of records) {
    const e = byTable.get(r.table) ?? { count: 0, ms: 0 }
    e.count++
    e.ms += r.ms
    byTable.set(r.table, e)
  }
  const rows = [...byTable.entries()]
    .map(([table, e]) => ({ table, count: e.count, totalMs: Math.round(e.ms) }))
    .sort((a, b) => b.count - a.count)

  /* eslint-disable no-console */
  console.log(
    `%c⏱ query burst: ${records.length} queries · wall ${wall}ms · serial-cost ${sumMs}ms · parallelism ${parallelism}×`,
    'color:#b45309;font-weight:bold',
  )
  console.table(rows)
  /* eslint-enable no-console */
}

/**
 * Drop-in replacement for `fetch`, passed to createClient's `global.fetch`.
 * Delegates to the real fetch unchanged; only observes timing/status.
 */
export const instrumentedFetch: typeof fetch = async (input, init) => {
  if (!enabled()) return fetch(input, init)

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const isRest = url.includes('/rest/v1/')
  if (!isRest) return fetch(input, init)

  const method = (init?.method ?? 'GET').toUpperCase()
  const start = performance.now()
  if (batch.length === 0) batchStart = start

  try {
    const res = await fetch(input, init)
    const end = performance.now()
    if (end > batchEndMax) batchEndMax = end
    batch.push({ table: tableFromUrl(url), method, ms: end - start, status: res.status })
    scheduleFlush()
    return res
  } catch (err) {
    const end = performance.now()
    if (end > batchEndMax) batchEndMax = end
    batch.push({ table: tableFromUrl(url), method, ms: end - start, status: 0 })
    scheduleFlush()
    throw err
  }
}
