const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

export type ReportContext = 'branch' | 'factory' | 'admin_branches' | 'admin_factory'

export async function generateInsights(
  context: ReportContext,
  data: Record<string, unknown>,
  count = 3,
): Promise<string[]> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return ['ניתוח AI לא זמין — חסר מפתח API']

  const systemPrompt = `אתה אנליסט עסקי של רשת מאפיות בישראל.
ספק ${count} תובנות קצרות ומעשיות בעברית.
התמקד במספרים ספציפיים ובמגמות. היה ישיר ופרקטי.
החזר מערך JSON של מחרוזות בלבד, בלי טקסט נוסף.
דוגמה: ["תובנה ראשונה", "תובנה שנייה", "תובנה שלישית"]`

  const userPrompt = buildPrompt(context, data)

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, await response.text())
      return ['ניתוח AI לא זמין כרגע']
    }

    const result = await response.json()
    const text = result.content?.[0]?.text || ''
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) return parsed
    }
    return [text.trim() || 'לא ניתן לייצר תובנות']
  } catch (err) {
    console.error('AI insights error:', err)
    return ['ניתוח AI לא זמין כרגע']
  }
}

function buildPrompt(context: ReportContext, data: Record<string, unknown>): string {
  switch (context) {
    case 'branch':
      return `נתוני סניף:
הכנסות: ₪${data.revenue}, יעד: ₪${data.revenueTarget} (${data.achievementPct}%)
לייבור: ${data.laborPct}% (יעד: ${data.laborTarget}%)
פחת: ${data.wastePct}% (יעד: ${data.wasteTarget}%)
סל ממוצע: ₪${data.avgBasket} (יעד: ₪${data.basketTarget})
עסקאות: ${data.transactions} (יעד: ${data.transactionTarget})
מגמת הכנסות 7 ימים: ${JSON.stringify(data.dailyRevenue)}
ספק 2-3 הערות לשיפור.`

    case 'factory':
      return `נתוני מחלקת ייצור:
ייצור: ₪${data.production}
פסולת: ${data.wastePct}% (ממוצע 30 יום: ${data.wasteAvg30}%)
פריון: ₪${data.productivityPerHour}/שעה (ממוצע 30 יום: ₪${data.prodAvg30})
עלות עובדים: ₪${data.laborCost} (ממוצע 30 יום: ₪${data.laborAvg30})
ספק 2-3 הערות לשיפור.`

    case 'admin_branches':
      return `סיכום כל הסניפים:
${JSON.stringify(data.branches)}
סניף הטוב ביותר: ${data.bestBranch}
סניף החלש ביותר: ${data.worstBranch}
ספק 3 תובנות מרכזיות.`

    case 'admin_factory':
      return `סיכום מפעל:
ייצור כולל: ₪${data.totalProduction}
פסולת כוללת: ${data.wastePct}%
פריון כולל: ₪${data.productivity}/שעה
עלות עובדים: ₪${data.laborCost}
מחלקות: ${JSON.stringify(data.departments)}
ספק 3 תובנות מרכזיות.`

    default:
      return JSON.stringify(data)
  }
}
