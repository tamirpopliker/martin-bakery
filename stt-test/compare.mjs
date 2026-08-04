#!/usr/bin/env node
/**
 * השוואת ספקי תמלול עברי על ההקלטות ב-stt-test/
 *
 * הרצה:   node stt-test/compare.mjs
 * דורש:   stt-test/.env  עם המפתחות
 * פלט:    stt-test/RESULTS.md  +  stt-test/results.json
 *
 * ללא תלויות חיצוניות. Node 18+.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────────────────────
// 1. המשפטים הצפויים — מה שאמור היה להיאמר
// ─────────────────────────────────────────────────────────────

const EXPECTED = {
  1:  { cat: 'מספרים', text: 'תרשום פחת של שלוש מאות ארבעים שקל',                          must: [['340', 'שלוש מאות ארבעים', 'שלוש מאות וארבעים']] },
  2:  { cat: 'מספרים', text: 'תרשום פחת של אלף מאתיים וחמישים שקל',                        must: [['1250', '1,250', 'אלף מאתיים וחמישים', 'אלף מאתיים חמישים']] },
  3:  { cat: 'מספרים', text: 'תרשום הוצאה של שמונים ושבעה שקלים וחצי',                     must: [['87.5', '87', 'שמונים ושבעה', 'שמונים ושבע']] },
  4:  { cat: 'מספרים', text: 'הסכום הוא שבעת אלפים תשע מאות',                              must: [['7900', '7,900', 'שבעת אלפים תשע מאות']] },
  5:  { cat: 'מספרים', text: 'תרשום שישים וארבעה שקלים',                                   must: [['64', 'שישים וארבעה', 'ששים וארבעה']] },
  6:  { cat: 'מספרים', text: 'הפקדתי שנים עשר אלף שקל',                                    must: [['12000', '12,000', 'שנים עשר אלף']] },

  7:  { cat: 'סניפים', text: 'תרשום פחת בסניף הפועלים',                                    must: [['הפועלים']] },
  8:  { cat: 'סניפים', text: 'מה הרווח של אברהם אבינו',                                    must: [['אברהם'], ['אבינו']] },
  9:  { cat: 'סניפים', text: 'תבדוק לי את יעקב כהן',                                       must: [['יעקב'], ['כהן']] },
  10: { cat: 'סניפים', text: 'כמה הוצאות היו בסניף אברהם אבינו',                           must: [['אברהם'], ['אבינו']] },
  11: { cat: 'סניפים', text: 'תשווה בין הפועלים ליעקב כהן',                                must: [['הפועלים'], ['יעקב'], ['כהן']] },

  12: { cat: 'מוצרים', text: 'מילפה פטיסייר חלבי',                                          must: [['מילפה'], ['פטיסייר']] },
  13: { cat: 'מוצרים', text: 'בורקס גבינה בצק קפוא',                                        must: [['בורקס'], ['גבינה']] },
  14: { cat: 'מוצרים', text: 'לחמניה קלוע',                                                 must: [['לחמניה', 'לחמנייה'], ['קלוע']] },
  15: { cat: 'מוצרים', text: 'רוגלך שמרים',                                                 must: [['רוגלך'], ['שמרים']] },
  16: { cat: 'מוצרים', text: 'קראנץ שוקולד פרווה',                                          must: [['קראנץ'], ['פרווה']] },
  17: { cat: 'מוצרים', text: 'בינוני ריבת חלב',                                             must: [['ריבת'], ['חלב']] },
  18: { cat: 'מוצרים', text: 'לייקח ושיש',                                                  must: [['לייקח'], ['שיש']] },

  19: { cat: 'ספקים',  text: 'תרשום חשבונית מתנובה',                                        must: [['תנובה', 'מתנובה']] },
  20: { cat: 'ספקים',  text: 'הגיעה חשבונית ממחלבת ארגמן',                                  must: [['מחלבת', 'ממחלבת'], ['ארגמן']] },
  21: { cat: 'ספקים',  text: 'תוסיף הוצאה לכרמית',                                          must: [['כרמית', 'לכרמית']] },
  22: { cat: 'ספקים',  text: 'שטיבל שלחו חשבונית',                                          must: [['שטיבל']] },

  23: { cat: 'זמן',    text: 'תרשום את זה על אתמול',                                        must: [['אתמול']] },
  24: { cat: 'זמן',    text: 'מה היה שלשום',                                                must: [['שלשום']] },
  25: { cat: 'זמן',    text: 'תראה לי את החודש שעבר',                                       must: [['החודש'], ['שעבר']] },
  26: { cat: 'זמן',    text: 'ביום ראשון האחרון',                                           must: [['ראשון'], ['האחרון']] },

  27: { cat: 'מלא',    text: 'תרשום פחת של שלוש מאות ארבעים שקל אתמול בסניף הפועלים',       must: [['340', 'שלוש מאות ארבעים', 'שלוש מאות וארבעים'], ['אתמול'], ['הפועלים']] },
  28: { cat: 'מלא',    text: 'כמה פחת היה החודש בכל הסניפים',                               must: [['פחת'], ['הסניפים']] },
  29: { cat: 'מלא',    text: 'תרשום הוצאה של אלף ומאתיים שקל לספק תנובה בסניף יעקב כהן',    must: [['1200', '1,200', 'אלף ומאתיים', 'אלף מאתיים'], ['תנובה'], ['יעקב'], ['כהן']] },
  30: { cat: 'מלא',    text: 'מה הרווח של המפעל החודש לעומת החודש שעבר',                    must: [['המפעל'], ['שעבר']] },

  31: { cat: 'קופה',   text: 'מכירות מזומן אלף שלוש מאות עשרים אשראי אלפיים ארבע מאות',     must: [['1320', '1,320', 'אלף שלוש מאות עשרים'], ['2400', '2,400', 'אלפיים ארבע מאות'], ['מזומן'], ['אשראי']] },
  32: { cat: 'קופה',   text: 'ארבעים ושבע עסקאות',                                          must: [['47', 'ארבעים ושבע'], ['עסקאות']] },
  33: { cat: 'קופה',   text: 'שני שטרות של מאתיים חמישה של מאה שלושה של חמישים',            must: [['מאתיים'], ['מאה'], ['חמישים']] },
  34: { cat: 'קופה',   text: 'יתרת הפתיחה היא שמונה מאות',                                  must: [['יתרת'], ['800', 'שמונה מאות']] },
  39: { cat: 'קופה',   text: 'נספר בקופה אלפיים ותשעים שקל',                                must: [['נספר'], ['2090', '2,090', 'אלפיים ותשעים', 'אלפיים תשעים']] },

  35: { cat: 'עוגות',  text: 'עוגה פרווה רבע פלטה טורט שוקולד מילוי קרמל',                  must: [['פרווה'], ['רבע'], ['פלטה'], ['טורט'], ['קרמל']] },
  36: { cat: 'עוגות',  text: 'ציפוי מזרה סוכריות ורודות כתר תכלת לבן',                      must: [['מזרה'], ['סוכריות'], ['ורודות'], ['תכלת']] },
  37: { cat: 'עוגות',  text: 'עוגה חלבית עגולה בינונית היער השחור',                         must: [['עגולה'], ['בינונית'], ['היער'], ['השחור']] },
  38: { cat: 'עוגות',  text: 'ציפוי שתי וערב עם דובדבנים אקסטרה וכדורי שוקולד',             must: [['שתי'], ['וערב'], ['דובדבנים'], ['אקסטרה']] },
}

// ─────────────────────────────────────────────────────────────
// 2. אוצר המילים להטיה — בדיוק מה שיוזן ל-STT בייצור
// ─────────────────────────────────────────────────────────────

const VOCABULARY = [
  // סניפים
  'הפועלים', 'אברהם אבינו', 'יעקב כהן',
  // ספקים
  'תנובה', 'טרה', 'מחלבת ארגמן', 'מחלבת גד', 'כרמית', 'מייסטר', 'שטיבל',
  'זול פעמי', 'ענבי ציון', 'פוליבה', 'לויאני', 'רימון תוצרת טרייה',
  // מוצרים
  'מילפה פטיסייר', 'בורקס גבינה', 'לחמניה קלוע', 'רוגלך שמרים',
  'קראנץ שוקולד', 'ריבת חלב', 'לייקח', 'שיש', 'פחזניות', 'אלפחורס', 'גביניות',
  // עוגות מיוחדות
  'חלבי', 'פרווה', 'עגולה גדולה', 'עגולה בינונית', 'ריבוע', 'רבע פלטה', 'לב',
  'וניל', 'שוקולד', 'שאנטי שוקולד', 'קרם שוקולד פרווה', 'קרם וניל פרווה',
  'תות', 'אוכמניות', 'קרמל', 'קרם בלבד', 'פירות יער', 'היער השחור', 'שוקו שוקו',
  'מזרה סוכריות', 'קוקוס קלוי', 'אגוזי מלך טחונים', 'קרם חלק', 'שתי וערב',
  'צבעוניות', 'לבנות', 'חומות', 'ורודות', 'תכלת', 'תכלת-לבן', 'ורוד-לבן', 'חום-לבן',
  'דובדבנים', 'דובדבנים אקסטרה', 'כדורי שוקולד', 'טורט', 'כתר',
  // מונחי תפעול
  'פחת', 'קופת עודף', 'סגירת קופה', 'הפקדה', 'יתרת פתיחה', 'נספר',
  'מזומן', 'אשראי', 'שיקים', 'עסקאות', 'סטייה', 'חשבונית', 'ספק',
  'אתמול', 'שלשום', 'היום',
].join(', ')

// ─────────────────────────────────────────────────────────────
// 3. ספקים
// ─────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: 'openai-plain',
    label: 'OpenAI gpt-4o-transcribe (ללא הטיה)',
    envKey: 'OPENAI_API_KEY',
    async run(buf, filename, key) {
      const fd = new FormData()
      fd.append('file', new Blob([buf]), filename)
      fd.append('model', 'gpt-4o-transcribe')
      fd.append('language', 'he')
      fd.append('response_format', 'text')
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      return (await r.text()).trim()
    },
  },
  {
    id: 'openai-biased',
    label: 'OpenAI gpt-4o-transcribe (עם הטיית אוצר מילים)',
    envKey: 'OPENAI_API_KEY',
    async run(buf, filename, key) {
      const fd = new FormData()
      fd.append('file', new Blob([buf]), filename)
      fd.append('model', 'gpt-4o-transcribe')
      fd.append('language', 'he')
      fd.append('response_format', 'text')
      fd.append('prompt', `מונחים אפשריים: ${VOCABULARY}`)
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      return (await r.text()).trim()
    },
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe',
    envKey: 'ELEVENLABS_API_KEY',
    async run(buf, filename, key) {
      const fd = new FormData()
      fd.append('file', new Blob([buf]), filename)
      fd.append('model_id', 'scribe_v1')
      fd.append('language_code', 'heb')
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST', headers: { 'xi-api-key': key }, body: fd,
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      const j = await r.json()
      return (j.text ?? '').trim()
    },
  },
]

// ─────────────────────────────────────────────────────────────
// 4. עזרים
// ─────────────────────────────────────────────────────────────

function loadEnv() {
  const p = join(DIR, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '').trim()
  }
}

const norm = (s) => (s || '')
  .replace(/[֑-ׇ]/g, '')          // ניקוד וטעמים
  .replace(/["'`״׳,.!?;:()\[\]{}\-–—]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

function wer(ref, hyp) {
  const a = norm(ref).split(' ').filter(Boolean)
  const b = norm(hyp).split(' ').filter(Boolean)
  if (!a.length) return b.length ? 1 : 0
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1])
  return d[a.length][b.length] / a.length
}

// כל קבוצת must היא רשימת חלופות — מספיק שאחת מהן מופיעה
function criticalHits(must, hyp) {
  const h = ' ' + norm(hyp) + ' '
  const hits = must.map((alts) => alts.some((alt) => h.includes(norm(alt))))
  return { hit: hits.filter(Boolean).length, total: hits.length,
           missed: must.filter((_, i) => !hits[i]).map((alts) => alts[0]) }
}

// ─────────────────────────────────────────────────────────────
// 5. הרצה
// ─────────────────────────────────────────────────────────────

loadEnv()

const files = readdirSync(DIR)
  .filter((f) => /\.(m4a|mp3|mp4|wav|ogg|webm|flac)$/i.test(f))
  .map((f) => ({ f, n: parseInt(basename(f, extname(f)), 10) }))
  .filter((x) => Number.isFinite(x.n) && EXPECTED[x.n])
  .sort((a, b) => a.n - b.n)

if (!files.length) {
  console.error('לא נמצאו קבצי אודיו ב-' + DIR)
  process.exit(1)
}

const active = PROVIDERS.filter((p) => {
  if (process.env[p.envKey]) return true
  console.warn(`⏭  מדלג על ${p.label} — חסר ${p.envKey}`)
  return false
})

if (!active.length) {
  console.error('\nאין אף מפתח API. צור stt-test/.env לפי stt-test/.env.example')
  process.exit(1)
}

console.log(`\n${files.length} הקלטות · ${active.length} ספקים · ${files.length * active.length} קריאות\n`)

const results = {}

for (const p of active) {
  results[p.id] = { label: p.label, items: {} }
  const key = process.env[p.envKey]
  process.stdout.write(`${p.label}\n  `)

  for (const { f, n } of files) {
    const exp = EXPECTED[n]
    try {
      const buf = readFileSync(join(DIR, f))
      const t0 = Date.now()
      const text = await p.run(buf, f, key)
      const crit = criticalHits(exp.must, text)
      results[p.id].items[n] = {
        cat: exp.cat, expected: exp.text, got: text,
        wer: +wer(exp.text, text).toFixed(3),
        crit: `${crit.hit}/${crit.total}`, missed: crit.missed,
        ms: Date.now() - t0,
      }
      process.stdout.write(crit.hit === crit.total ? '✓' : '✗')
    } catch (e) {
      results[p.id].items[n] = { cat: exp.cat, expected: exp.text, error: String(e.message) }
      process.stdout.write('!')
    }
  }
  process.stdout.write('\n\n')
}

// ─────────────────────────────────────────────────────────────
// 6. דוח
// ─────────────────────────────────────────────────────────────

const CATS = ['מספרים', 'סניפים', 'מוצרים', 'ספקים', 'זמן', 'מלא', 'קופה', 'עוגות']
const out = ['# תוצאות השוואת ספקי תמלול', '',
  `נוצר: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${files.length} הקלטות`, '',
  '## סיכום — אחוז מילות מפתח שנקלטו נכון', '',
  '| קטגוריה | ' + active.map((p) => p.label).join(' | ') + ' |',
  '|---|' + active.map(() => '---').join('|') + '|']

const pct = (id, filter) => {
  const its = Object.values(results[id].items).filter(filter).filter((i) => i.crit)
  if (!its.length) return '—'
  const [h, t] = its.reduce(([a, b], i) => {
    const [x, y] = i.crit.split('/').map(Number); return [a + x, b + y]
  }, [0, 0])
  return t ? `${Math.round((h / t) * 100)}%` : '—'
}

for (const c of CATS) {
  out.push(`| **${c}** | ` + active.map((p) => pct(p.id, (i) => i.cat === c)).join(' | ') + ' |')
}
out.push('| **הכל** | ' + active.map((p) => pct(p.id, () => true)).join(' | ') + ' |', '')

out.push('## WER ממוצע (נמוך = טוב)', '',
  '| ספק | WER | זמן ממוצע |', '|---|---|---|')
for (const p of active) {
  const its = Object.values(results[p.id].items).filter((i) => i.wer != null)
  const w = its.length ? (its.reduce((s, i) => s + i.wer, 0) / its.length).toFixed(3) : '—'
  const ms = its.length ? Math.round(its.reduce((s, i) => s + i.ms, 0) / its.length) : '—'
  out.push(`| ${p.label} | ${w} | ${ms}ms |`)
}
out.push('')

out.push('## פירוט מלא', '')
for (const { n } of files) {
  const e = EXPECTED[n]
  out.push(`### ${n} · ${e.cat}`, '', `**צפוי:** ${e.text}`, '')
  for (const p of active) {
    const r = results[p.id].items[n]
    if (!r) continue
    if (r.error) { out.push(`- ❗ **${p.label}** — שגיאה: \`${r.error}\``); continue }
    const ok = r.crit.split('/')[0] === r.crit.split('/')[1]
    out.push(`- ${ok ? '✅' : '❌'} **${p.label}** — \`${r.got}\``)
    out.push(`  - מילות מפתח ${r.crit} · WER ${r.wer}${r.missed.length ? ` · פוספסו: ${r.missed.join(', ')}` : ''}`)
  }
  out.push('')
}

writeFileSync(join(DIR, 'RESULTS.md'), out.join('\n'), 'utf8')
writeFileSync(join(DIR, 'results.json'), JSON.stringify(results, null, 2), 'utf8')

console.log('נכתב:')
console.log('  stt-test/RESULTS.md')
console.log('  stt-test/results.json\n')
for (const p of active) console.log(`  ${p.label}: ${pct(p.id, () => true)} מילות מפתח`)
console.log()
