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

    const prompt = `You design edible cake-topper overlays for an Israeli bakery. Your single most important job is choosing a TEXT POSITION and TEXT COLOR that maximize legibility on this specific photo.

═══════════════════════════════════════════════════
STEP 1 — ANALYZE THE PHOTO (think carefully before answering):
═══════════════════════════════════════════════════
A. Where is the SUBJECT? (face, cake, focal object) — top/middle/bottom × left/center/right.
   The text must NEVER cover the subject — especially never over a face.
B. Where is the LARGEST CLEAN AREA? (uniform color, low detail, no faces/objects).
   This is where the text WILL go — find the biggest such region.
C. What is the DOMINANT COLOR / TONE of that clean area?
   - Light: white/cream/pastel/sky-blue/light-grass
   - Dark: navy/forest/black/dark-skin/shadow/night
   - Warm: red/orange/brown/skin-tones/sand/wood
   - Cool: blue/green/teal/grey
   - Multi-busy: many competing colors with no clear dominant

═══════════════════════════════════════════════════
STEP 2 — PICK A POSITION FROM STEP 1B
═══════════════════════════════════════════════════
The text goes in the CLEAN area you identified. Map it to one of the 9 keys.
- Clean area on the left → use *-left.   On the right → *-right.   Centered → *-center.
- Top of frame → top-*.   Middle → middle-*.   Bottom → bottom-*.
- DO NOT default to bottom-center unless that's actually where the cleanest area is.

═══════════════════════════════════════════════════
STEP 3 — PICK A STYLE WITH MAXIMUM CONTRAST AGAINST STEP 1C
═══════════════════════════════════════════════════
Goal: pick the option that POPS MOST against the dominant tone where the text will sit.

If clean area is LIGHT (white/pastel/cream/light-blue/light-grass):
  → Strongest pops: navy, burgundy, classic (black-on-white).
  → Avoid: pink, gold-on-light (low contrast).

If clean area is DARK (night/shadow/black/dark-skin/forest):
  → Strongest pops: gold, neon (pink glow), classic-inverted (white text — pick "classic", the white-stroke shows on dark).
  → Avoid: navy, burgundy on dark (blends).

If clean area is WARM (red/orange/sand/skin/wood):
  → Strongest pops: navy, green (forest), classic.
  → Avoid: gold, burgundy (similar tone).

If clean area is COOL (blue/green/teal):
  → Strongest pops: gold, neon, burgundy.
  → Avoid: navy on blue (blends).

If clean area is MULTI-BUSY:
  → Use classic — the white outline + black fill reads on anything.

If the photo is romantic/elegant → bias gold (weddings) when contrast allows.
If the photo is vibrant/festive → bias neon when contrast allows.
"shadow" only when minimal/modern style is requested by photo aesthetic AND the background is uniform-light.

DO NOT default to "classic" just to be safe. Pick the BOLDEST option that still reads.

═══════════════════════════════════════════════════
STEP 4 — PICK FONT (matches occasion + photo mood)
═══════════════════════════════════════════════════
- Kids / playful birthday photo → rubik
- Wedding / engagement / formal → frank or assistant
- Generic מזל טוב / casual → heebo
- Party / colorful → karantina or rubik
- Stylish/distinctive → suez

═══════════════════════════════════════════════════
STEP 5 — SIZE
═══════════════════════════════════════════════════
- ≤6 chars → huge
- 7-15 chars → large (default for short texts)
- 16-30 chars → medium
- 31+ chars → small
Multi-line text counts as length of longest line.

═══════════════════════════════════════════════════
INPUT
═══════════════════════════════════════════════════
Cake size: ${presetLabel}
Text: """${text}"""
Text length: ${text.length} chars
Lines: ${text.split('\n').length}

FONTS available:
${fontList}

STYLES available:
${styleList}

═══════════════════════════════════════════════════
OUTPUT — strict JSON only, no prose:
═══════════════════════════════════════════════════
{
  "font":     one of [${fontKeys.map((f) => `"${f}"`).join(', ')}],
  "style":    one of [${styleKeys.map((s) => `"${s}"`).join(', ')}],
  "sizeKey":  one of ["small", "medium", "large", "huge"],
  "position": one of ["top-left","top-center","top-right","middle-left","middle-center","middle-right","bottom-left","bottom-center","bottom-right"],
  "reasoning": "<one Hebrew sentence ≤95 chars: name what you saw in the photo (subject + clean area + dominant tone) + why this style+position+font give max contrast/fit>"
}`

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
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
