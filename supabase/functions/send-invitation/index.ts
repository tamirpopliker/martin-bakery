import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const RESEND_API_URL = 'https://api.resend.com/emails'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { email, name, senderName } = await req.json()

    if (!email || !name) {
      return new Response(JSON.stringify({ error: 'Missing email or name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const fromEmail = Deno.env.get('REPORT_FROM_EMAIL') || 'reports@martinbakery.co.il'

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #f8fafc; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #0f172a; font-size: 22px; margin: 0;">קונדיטוריית מרטין 🧁</h1>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">מערכת ניהול</p>
        </div>
        <div style="background: white; border-radius: 10px; padding: 24px; border: 1px solid #e2e8f0;">
          <p style="color: #0f172a; font-size: 16px; margin: 0 0 16px;">שלום ${name},</p>
          <p style="color: #334155; font-size: 15px; line-height: 1.7; margin: 0 0 20px;">
            הוזמנת להצטרף למערכת הניהול של קונדיטוריית מרטין.
          </p>
          <div style="background: #f0f9ff; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <p style="color: #0369a1; font-size: 14px; font-weight: 700; margin: 0 0 12px;">כך תתחבר:</p>
            <ol style="color: #334155; font-size: 14px; line-height: 2; margin: 0; padding-right: 20px;">
              <li>לחץ על הקישור: <a href="https://martin-bakery.vercel.app" style="color: #2563eb;">martin-bakery.vercel.app</a></li>
              <li>לחץ על "התחבר עם Google"</li>
              <li>השתמש בחשבון Google שלך: <strong>${email}</strong></li>
            </ol>
          </div>
          <p style="color: #334155; font-size: 14px; line-height: 1.7; margin: 0 0 8px;">
            במערכת תוכל לראות את הסידור שלך, המשימות והעדכונים.
          </p>
          <p style="color: #64748b; font-size: 14px; margin: 20px 0 0;">
            בברכה,<br/>
            <strong>${senderName || 'צוות קונדיטוריית מרטין'}</strong>
          </p>
        </div>
      </div>
    `

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `קונדיטוריית מרטין <${fromEmail}>`,
        to: email,
        subject: 'הזמנה למערכת הניהול — קונדיטוריית מרטין',
        html,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Resend error:', response.status, err)
      return new Response(JSON.stringify({ error: err }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
