import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { pdf_base64, image_base64, image_media_type, extract_type } = body

    if (!pdf_base64 && !image_base64) {
      return new Response(JSON.stringify({ error: 'Missing pdf_base64 or image_base64' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const isZReport = extract_type === 'z_report' && image_base64
    const mediaType = image_media_type || 'image/jpeg'

    const content: any[] = []
    if (isZReport) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: image_base64 },
      })
      content.push({
        type: 'text',
        text: `אתה מחלץ נתונים מדוח Z של קופה רושמת ישראלית. חלץ בדיוק את הסכומים הבאים בפורמט JSON בלבד, ללא טקסט נוסף, ללא Markdown:
{
  "cash_sales": סך מכירות במזומן (כמספר עשרוני בלבד, ללא ₪),
  "credit_sales": סך מכירות באשראי / כרטיסי אשראי (כמספר עשרוני בלבד)
}
אם שדה לא נמצא — החזר null עבורו. אל תחזיר הסברים או טקסט נוסף.`,
      })
    } else {
      content.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdf_base64 },
      })
      content.push({
        type: 'text',
        text: `אתה מחלץ נתונים מחשבוניות מס ישראליות. חלץ את הנתונים הבאים בפורמט JSON בלבד, ללא טקסט נוסף:
{
  "customer_name": "שם הלקוח או העסק",
  "invoice_number": "מספר החשבונית",
  "invoice_date": "תאריך החשבונית בפורמט DD/MM/YYYY",
  "total_before_vat": סה״כ לפני מע״מ כמספר עשרוני בלבד
}
אם שדה לא נמצא — החזר null`,
      })
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    if (!isZReport) headers['anthropic-beta'] = 'pdfs-2024-09-25'

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('Anthropic API error:', response.status, errBody)
      return new Response(JSON.stringify({ error: `Anthropic API ${response.status}`, details: errBody }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = await response.json()
    const text = result.content?.[0]?.text || ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Could not parse response', raw: text }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const extracted = JSON.parse(jsonMatch[0])

    return new Response(JSON.stringify({ success: true, data: extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
