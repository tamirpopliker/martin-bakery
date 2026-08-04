// ═══════════════════════════════════════════════════════════════════════
// Vocabulary biasing for Hebrew transcription.
//
// This is not an optimisation — it is the mechanism. Measured on 39 real
// recordings (stt-test/RESULTS.md, 03/08/2026):
//
//     overall      83%  →  99%
//     cake terms   65%  →  100%
//     latency    1042ms →  776ms
//
// Without it, "מזרה סוכריות" comes back as "מזרע סוכריות", "היער השחור"
// as "היה הר שחור", and — most dangerously — "נספר בקופה" as "נשאר בקופה":
// two valid Hebrew sentences with opposite meanings.
//
// Built from the database, so a new supplier or branch is covered tomorrow
// with nobody maintaining a list.
//
// See AGENT_PLAN.md sections 8.3.1 and 8.4.
// ═══════════════════════════════════════════════════════════════════════

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Cake order option values ──
// MIRRORED from src/pages/BranchSpecialOrders.tsx:57-76. Edge functions
// cannot import from src/. If the form's constants change, change these too.
const CAKE_TERMS = [
  'חלבי', 'פרווה',
  'עגולה גדולה', 'עגולה בינונית', 'ריבוע', 'רבע פלטה', 'לב',
  'וניל', 'שוקולד',
  'שאנטי שוקולד', 'קרם שוקולד פרווה', 'קרם וניל פרווה',
  'ריבת חלב', 'תות', 'אוכמניות', 'קרמל', 'קרם בלבד',
  'פירות יער', 'היער השחור', 'שוקו שוקו',
  'מזרה סוכריות', 'קוקוס קלוי', 'אגוזי מלך טחונים', 'קרם חלק', 'שתי וערב',
  'צבעוניות', 'לבנות', 'חומות', 'ורודות', 'תכלת',
  'תכלת-לבן', 'ורוד-לבן', 'חום-לבן',
  'דובדבנים', 'דובדבנים אקסטרה', 'כדורי שוקולד', 'אגוזי מלך',
  'טורט', 'כתר', 'ציפוי', 'מילוי',
]

// ── Operational verbs and nouns ──
// Verbs matter as much as nouns: the נספר/נשאר confusion was a verb.
const OPERATIONAL_TERMS = [
  'פחת', 'קופת עודף', 'סגירת קופה', 'הפקדה', 'יתרת פתיחה', 'נספר',
  'מזומן', 'אשראי', 'שיקים', 'עסקאות', 'סטייה', 'חשבונית', 'ספק', 'הוצאה',
  'תרשום', 'תוסיף', 'תעדכן', 'תבדוק',
  'אתמול', 'שלשום', 'היום', 'החודש שעבר',
]

// Character budget. The transcription prompt is length-limited, so terms are
// added in priority order and the tail is dropped if needed. Verified working
// at ~1200 chars in the bake-off; kept generous but bounded.
const BUDGET = 2000

interface Cached { at: number; value: string }
let cache: Cached | null = null
const TTL_MS = 6 * 60 * 60 * 1000 // 6h — per warm instance, best effort

/**
 * Builds the biasing prompt. Terms are added highest-value first so that if
 * the budget truncates, the most useful ones survive.
 *
 * Priority: learned corrections → branches → cake terms → operational →
 *           suppliers → products.
 */
export async function buildVocabularyPrompt(db: SupabaseClient): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value

  const groups: string[][] = []

  // 1. Approved corrections — highest value, explicitly contrastive.
  try {
    const { data } = await db
      .from('agent_corrections')
      .select('heard, meant')
      .eq('status', 'active')
      .order('occurrences', { ascending: false })
      .limit(40)
    if (data?.length) {
      groups.push(data.map((c) => `${c.meant} (לא ${c.heard})`))
    }
  } catch (e) {
    console.warn('[vocabulary] corrections unavailable:', e)
  }

  // 2. Branches — small, always fits, always relevant.
  try {
    const { data } = await db.from('branches').select('name, short_name').eq('active', true)
    if (data?.length) {
      groups.push(data.flatMap((b) => [b.short_name, b.name].filter(Boolean) as string[]))
    }
  } catch (e) {
    console.warn('[vocabulary] branches unavailable:', e)
  }

  // 3. Closed sets — the biggest measured win.
  groups.push(CAKE_TERMS)
  groups.push(OPERATIONAL_TERMS)

  // 4. Suppliers.
  try {
    const { data } = await db
      .from('suppliers_new')
      .select('name')
      .eq('active', true)
      .limit(60)
    if (data?.length) groups.push(data.map((s) => s.name))
  } catch (e) {
    console.warn('[vocabulary] suppliers unavailable:', e)
  }

  // 5. Products — free text on order items; `products` itself is empty.
  try {
    const { data } = await db
      .from('internal_sale_items')
      .select('product_name')
      .limit(600)
    if (data?.length) {
      const counts = new Map<string, number>()
      for (const r of data) {
        const n = (r.product_name || '').trim()
        if (n) counts.set(n, (counts.get(n) ?? 0) + 1)
      }
      groups.push(
        [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([n]) => n),
      )
    }
  } catch (e) {
    console.warn('[vocabulary] products unavailable:', e)
  }

  // Flatten, dedupe, then fill up to the budget in priority order.
  const seen = new Set<string>()
  const terms: string[] = []
  let len = 0
  for (const group of groups) {
    for (const raw of group) {
      const t = (raw || '').trim()
      if (!t || seen.has(t)) continue
      if (len + t.length + 2 > BUDGET) continue
      seen.add(t)
      terms.push(t)
      len += t.length + 2
    }
  }

  const value = `תמלול בעברית של הוראות תפעול למאפייה. מונחים אפשריים: ${terms.join(', ')}.`
  cache = { at: Date.now(), value }
  console.log(`[vocabulary] ${terms.length} terms, ${value.length} chars`)
  return value
}

/** Drops the cache so the next call rebuilds. Use after approving a correction. */
export function invalidateVocabularyCache(): void {
  cache = null
}
