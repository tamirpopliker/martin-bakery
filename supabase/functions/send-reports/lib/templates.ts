// ─── Email Layout ────────────────────────────────────────────────────────────

export function emailLayout(title: string, body: string, subtitle?: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e3a5f,#2d5a8e);border-radius:16px 16px 0 0;padding:28px 32px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:white;margin-bottom:2px;">${title}</div>
          ${subtitle ? `<div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">${subtitle}</div>` : ''}
        </td></tr>

        <!-- Body -->
        <tr><td style="background:white;padding:24px 28px;">
          ${body}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-radius:0 0 16px 16px;padding:16px 28px;text-align:center;">
          <div style="font-size:11px;color:#94a3b8;">דוח אוטומטי &middot; מערכת ניהול מרטין</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Reusable Components ────────────────────────────────────────────────────

export function sectionHeader(text: string): string {
  return `<div style="font-size:16px;font-weight:700;color:#0f172a;margin:24px 0 12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0;">${text}</div>`
}

/** KPI metric box with color indicator */
export function kpiBox(
  label: string,
  value: string,
  target: string,
  isGood: boolean,
): string {
  const color = isGood ? '#10b981' : '#ef4444'
  const bg = isGood ? '#f0fdf4' : '#fef2f2'
  return `<td style="padding:6px;">
    <div style="background:${bg};border:1px solid ${color}33;border-radius:12px;padding:14px 12px;text-align:center;">
      <div style="font-size:11px;color:#64748b;margin-bottom:4px;">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${color};">${value}</div>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px;">יעד: ${target}</div>
    </div>
  </td>`
}

/** Full-width KPI row (use inside a table) */
export function kpiRow(items: Array<{ label: string; value: string; target: string; isGood: boolean }>): string {
  const cols = items.map(i => kpiBox(i.label, i.value, i.target, i.isGood)).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cols}</tr></table>`
}

/** Data table with headers and rows */
export function dataTable(headers: string[], rows: string[][]): string {
  const headerCells = headers.map(h =>
    `<th style="padding:10px 12px;text-align:right;font-size:12px;font-weight:600;color:#64748b;border-bottom:2px solid #e2e8f0;white-space:nowrap;">${h}</th>`
  ).join('')

  const bodyRows = rows.map((row, i) => {
    const bg = i % 2 === 0 ? 'white' : '#fafafa'
    const cells = row.map(cell =>
      `<td style="padding:10px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f1f5f9;">${cell}</td>`
    ).join('')
    return `<tr style="background:${bg};">${cells}</tr>`
  }).join('')

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
    <thead><tr style="background:#f8fafc;">${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`
}

/** Inline chart image */
export function chartImg(url: string, alt: string): string {
  return `<div style="text-align:center;margin:16px 0;">
    <img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0;" />
  </div>`
}

/** AI insights box */
export function insightsBox(insights: string[]): string {
  const items = insights.map(i =>
    `<li style="margin-bottom:8px;padding-right:8px;font-size:14px;color:#374151;line-height:1.6;">${i}</li>`
  ).join('')
  return `<div style="background:#eff6ff;border-radius:12px;padding:16px 20px;margin:20px 0;border:1px solid #bfdbfe;">
    <div style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:10px;">🤖 תובנות AI</div>
    <ul style="margin:0;padding-right:20px;list-style:disc;">${items}</ul>
  </div>`
}

/** Highlight box for best/worst branch */
export function highlightBox(label: string, value: string, color: string): string {
  return `<div style="display:inline-block;background:${color}15;border:1px solid ${color}33;border-radius:10px;padding:10px 18px;margin:4px;">
    <span style="font-size:12px;color:#64748b;">${label}:</span>
    <span style="font-size:14px;font-weight:700;color:${color};margin-right:6px;">${value}</span>
  </div>`
}

/** Format number as ₪ */
export function fmtCurrency(n: number): string {
  return '₪' + Math.round(n).toLocaleString('he-IL')
}

/** Format percentage */
export function fmtPct(n: number): string {
  return n.toFixed(1) + '%'
}

/** Status badge (good/bad) */
export function statusBadge(isGood: boolean, text?: string): string {
  const color = isGood ? '#10b981' : '#ef4444'
  const bg = isGood ? '#f0fdf4' : '#fef2f2'
  const label = text || (isGood ? '✓ בתקן' : '⚠ חריג')
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;">${label}</span>`
}
