// ═══════════════════════════════════════════════════════════════════════
// cake-design-suggest — AI design advisor for the cake-topper editor.
// Receives an uploaded image (signed Supabase URL) + the user-typed text,
// asks Claude vision to pick the best font / style / size / position from
// our curated curated set, and returns a JSON design suggestion.
// Never throws — returns a safe fallback on any failure.
// ═══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FONT_KEYS  = ['heebo', 'rubik', 'frank', 'suez', 'karantina', 'assistant'] as const
const STYLE_KEYS = ['classic', 'gold', 'pink', 'neon', 'navy', 'green', 'burgundy', 'shadow'] as const
const SIZE_KEYS  = ['small', 'medium', 'large', 'huge'] as const
const POSITIONS  = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const

const FONT_HINTS: Record<string, string> = {
  heebo: 'modern geometric sans, clean and professional',
  rubik: 'rounded sans, friendly, good for kids/birthdays',
  frank: 'luxurious serif, weddings/formal events',
  suez: 'distinctive display serif, stylish',
  karantina: 'playful display, parties/fun',
  assistant: 'minimalist sans, refined and understated',
}

const STYLE_HINTS: Record<string, string> = {
  classic:  'black fill + white outline — always readable',
  gold:     'gold fill + dark stroke — luxurious, weddings',
  pink:     'soft pastel pink — sweet, gentle',
  neon:     'hot pink with glow — vibrant, party',
  navy:     'navy blue + white — formal, professional',
  green:    'forest green + cream — natural, organic',
  burgundy: 'wine red + cream — elegant, winter',
  shadow:   'black with drop shadow — modern, soft',
}

const PRESET_LABELS: Record<string, string> = {
  round_medium: '15cm circle',
  round_large:  '18cm circle',
  square_20:    '20×20cm square',
  rect_full:    'A4 full sheet',
}

const FALLBACK = {
  font: 'heebo',
  style: 'classic',
  sizeKey: 'medium',
  position: 'bottom-center',
  reasoning: 'נטענה ברירת מחדל',
  fallback: true,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch ${res.status}`)
  const mediaType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
  const buf = new Uint8Array(await res.arrayBuffer())
  // Chunk to base64 to avoid call-stack overflow on large images
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunkSize))
  }
  return { data: btoa(binary), mediaType }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const {
      imageUrl,
      text,
      preset,
      fontKeys = FONT_KEYS,
      styleKeys = STYLE_KEYS,
    } = body as { imageUrl?: string; text?: string; preset?: string; fontKeys?: string[]; styleKeys?: string[] }

    if (!imageUrl || !text || !preset) {
      return jsonResponse({ ...FALLBACK, error: 'missing imageUrl/text/preset' })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return jsonResponse({ ...FALLBACK, error: 'missing ANTHROPIC_API_KEY' })
    }

    let imageBase64: string
    let mediaType: string
    try {
      const fetched = await fetchAsBase64(imageUrl)
      imageBase64 = fetched.data
      mediaType = fetched.mediaType
    } catch (e) {
      return jsonResponse({ ...FALLBACK, error: `image fetch failed: ${String(e)}` })
    }

    const fontList = fontKeys
      .filter((f) => FONT_HINTS[f])
      .map((f) => `- ${f}: ${FONT_HINTS[f]}`)
      .join('\n')
    const styleList = styleKeys
      .filter((s) => STYLE_HINTS[s])
      .map((s) => `- ${s}: ${STYLE_HINTS[s]}`)
      .join('\n')

    const presetLabel = PRESET_LABELS[preset] || preset

    const prompt = `You are a design advisor for an Israeli bakery's edible cake-topper editor. The bakery prints A4 edible-paper sheets and cuts the topper to the chosen shape.

Look at the user's photo and pick the best text overlay design for the Hebrew text below.

Photo size: ${presetLabel}
Hebrew text to overlay: "${text}"

Return strictly JSON, no prose, with these exact fields:
{
  "font":     one of [${fontKeys.map((f) => `"${f}"`).join(', ')}],
  "style":    one of [${styleKeys.map((s) => `"${s}"`).join(', ')}],
  "sizeKey":  one of ["small", "medium", "large", "huge"],
  "position": one of ["top-left","top-center","top-right","middle-left","middle-center","middle-right","bottom-left","bottom-center","bottom-right"],
  "reasoning": one short Hebrew sentence (max 90 characters) explaining the choice
}

Font catalog (pick ONE matching the photo's mood):
${fontList}

Style catalog (pick ONE that contrasts with the photo's dominant tones):
${styleList}

Rules:
- Use larger sizes for short texts and round shapes; smaller for long texts.
- Position the text where it does NOT cover the main subject of the photo.
- Avoid placing text over very busy or high-detail areas.
- Reasoning MUST be in Hebrew, single sentence, no quotes.`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 400,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: imageBase64 },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!aiRes.ok) {
      const errBody = await aiRes.text()
      console.error('Anthropic API error:', aiRes.status, errBody)
      return jsonResponse({ ...FALLBACK, error: `anthropic ${aiRes.status}` })
    }

    const result = await aiRes.json()
    const responseText: string = result.content?.[0]?.text || ''
    const match = responseText.match(/\{[\s\S]*\}/)
    if (!match) {
      console.error('Could not parse JSON from Claude:', responseText.slice(0, 500))
      return jsonResponse({ ...FALLBACK, error: 'unparseable response' })
    }

    let parsed: { font?: string; style?: string; sizeKey?: string; position?: string; reasoning?: string }
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return jsonResponse({ ...FALLBACK, error: 'invalid JSON' })
    }

    const safe = {
      font:     (FONT_KEYS as readonly string[]).includes(parsed.font)         ? parsed.font     : 'heebo',
      style:    (STYLE_KEYS as readonly string[]).includes(parsed.style)       ? parsed.style    : 'classic',
      sizeKey:  (SIZE_KEYS as readonly string[]).includes(parsed.sizeKey)      ? parsed.sizeKey  : 'medium',
      position: (POSITIONS as readonly string[]).includes(parsed.position)     ? parsed.position : 'bottom-center',
      reasoning: typeof parsed.reasoning === 'string' && parsed.reasoning.length > 0
        ? parsed.reasoning.slice(0, 120)
        : 'AI בחר עיצוב מתאים לתמונה',
      fallback: false,
    }

    return jsonResponse(safe)
  } catch (err) {
    console.error('cake-design-suggest error:', err)
    return jsonResponse({ ...FALLBACK, error: String(err) })
  }
})
