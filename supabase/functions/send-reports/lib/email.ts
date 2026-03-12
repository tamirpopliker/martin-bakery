const RESEND_API_URL = 'https://api.resend.com/emails'

interface EmailPayload {
  to: string
  subject: string
  html: string
}

export async function sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { success: false, error: 'Missing RESEND_API_KEY' }

  const fromEmail = Deno.env.get('REPORT_FROM_EMAIL') || 'reports@martinbakery.co.il'

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `מרטין דוחות <${fromEmail}>`,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('Resend error:', response.status, err)
      return { success: false, error: err }
    }

    return { success: true }
  } catch (err) {
    console.error('Email send error:', err)
    return { success: false, error: String(err) }
  }
}
