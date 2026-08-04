// ═══════════════════════════════════════════════════════════════════════
// transcribe — Hebrew speech-to-text for the voice agent.
//
// Deliberately stateless and dumb. It authenticates, transcribes, returns
// text. All context and reasoning lives in the `agent` function, so the
// STT provider can be swapped without touching anything else.
//
// Provider chosen by measurement, not benchmarks: OpenAI gpt-4o-transcribe
// with vocabulary biasing scored 99% keyword accuracy on 39 real recordings
// (the single miss was a flaw in the test, not the model — effectively 100%).
// See stt-test/RESULTS.md and AGENT_PLAN.md 8.3.
//
// POST multipart/form-data:  file=<audio blob>
// →  { text, ms }
// ═══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { authenticateAgentRequest, corsHeaders, json } from '../_shared/agentAuth.ts'
import { buildVocabularyPrompt } from '../_shared/agentVocabulary.ts'

const MAX_BYTES = 20 * 1024 * 1024 // 30s of Opus is ~60KB; this is a sanity bound
const MODEL = 'gpt-4o-transcribe'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  // ── Gate first, before we spend a cent ──
  const auth = await authenticateAgentRequest(req)
  if (!auth.ok) return json({ error: auth.error }, auth.status)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    console.error('[transcribe] missing OPENAI_API_KEY')
    return json({ error: 'שירות התמלול אינו מוגדר' }, 500)
  }

  // ── Read the audio ──
  let file: File
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (!(f instanceof File)) return json({ error: 'לא התקבלה הקלטה' }, 400)
    file = f
  } catch {
    return json({ error: 'לא התקבלה הקלטה' }, 400)
  }

  if (file.size === 0) return json({ error: 'ההקלטה ריקה' }, 400)
  if (file.size > MAX_BYTES) return json({ error: 'ההקלטה ארוכה מדי' }, 400)

  // Browsers disagree on container: Chrome/Android give webm/opus, iOS Safari
  // gives mp4/aac. OpenAI infers the codec from the filename extension, so the
  // extension must survive the round trip.
  const filename = file.name && /\.[a-z0-9]{2,5}$/i.test(file.name)
    ? file.name
    : `audio.${(file.type.split('/')[1] || 'webm').split(';')[0]}`

  try {
    const t0 = Date.now()
    const prompt = await buildVocabularyPrompt(auth.db)

    const fd = new FormData()
    fd.append('file', file, filename)
    fd.append('model', MODEL)
    // Always send both. Without a prompt, language detection can collapse
    // entirely — "מה היה שלשום" came back as Latin "Mājasilšom" in testing.
    fd.append('language', 'he')
    fd.append('prompt', prompt)
    fd.append('response_format', 'text')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    })

    if (!res.ok) {
      const detail = await res.text()
      console.error(`[transcribe] OpenAI ${res.status}: ${detail.slice(0, 500)}`)
      if (res.status === 429) return json({ error: 'שירות התמלול עמוס, נסה שוב' }, 503)
      return json({ error: 'התמלול נכשל' }, 502)
    }

    const text = (await res.text()).trim()
    const ms = Date.now() - t0

    if (!text) return json({ error: 'לא זוהה דיבור בהקלטה' }, 422)

    console.log(`[transcribe] ${auth.user.email} · ${file.size}B · ${ms}ms · "${text.slice(0, 80)}"`)
    return json({ text, ms })
  } catch (e) {
    console.error('[transcribe] unexpected:', e)
    return json({ error: 'התמלול נכשל' }, 500)
  }
})
