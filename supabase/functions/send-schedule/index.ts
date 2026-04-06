import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const RESEND_API_URL = 'https://api.resend.com/emails'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const hebrewDays: Record<number, string> = {
  0: 'ראשון',
  1: 'שני',
  2: 'שלישי',
  3: 'רביעי',
  4: 'חמישי',
  5: 'שישי',
  6: 'שבת',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { branch_id, week_start, week_end } = await req.json()

    if (!branch_id || !week_start || !week_end) {
      return new Response(JSON.stringify({ error: 'Missing branch_id, week_start, or week_end' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing RESEND_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch assignments for the week
    const { data: assignments, error: assignErr } = await adminClient
      .from('shift_assignments')
      .select('id, shift_id, employee_id, role_id, date')
      .eq('branch_id', branch_id)
      .gte('date', week_start)
      .lte('date', week_end)

    if (assignErr) {
      console.error('Error fetching assignments:', assignErr)
      return new Response(JSON.stringify({ error: assignErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!assignments || assignments.length === 0) {
      return new Response(JSON.stringify({ sent: 0, skipped: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Collect unique IDs
    const employeeIds = [...new Set(assignments.map((a) => a.employee_id))]
    const shiftIds = [...new Set(assignments.map((a) => a.shift_id))]
    const roleIds = [...new Set(assignments.map((a) => a.role_id).filter(Boolean))]

    // Fetch employees, shifts, roles in parallel
    const [empsRes, shiftsRes, rolesRes] = await Promise.all([
      adminClient.from('branch_employees').select('id, name, email').in('id', employeeIds),
      adminClient.from('branch_shifts').select('id, name, start_time, end_time').in('id', shiftIds),
      roleIds.length > 0
        ? adminClient.from('shift_roles').select('id, name').in('id', roleIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    const employeesMap = new Map((empsRes.data || []).map((e) => [e.id, e]))
    const shiftsMap = new Map((shiftsRes.data || []).map((s) => [s.id, s]))
    const rolesMap = new Map((rolesRes.data || []).map((r) => [r.id, r]))

    // Group assignments by employee_id
    const grouped = new Map<number, typeof assignments>()
    for (const a of assignments) {
      if (!grouped.has(a.employee_id)) {
        grouped.set(a.employee_id, [])
      }
      grouped.get(a.employee_id)!.push(a)
    }

    let sent = 0
    let skipped = 0

    // Build full branch calendar grouped by date → shift → assignments
    const dates = [...new Set(assignments.map(a => a.date))].sort()
    const shiftsByDate = new Map<string, Map<number, typeof assignments>>()
    for (const a of assignments) {
      if (!shiftsByDate.has(a.date)) shiftsByDate.set(a.date, new Map())
      const dateMap = shiftsByDate.get(a.date)!
      if (!dateMap.has(a.shift_id)) dateMap.set(a.shift_id, [])
      dateMap.get(a.shift_id)!.push(a)
    }

    for (const [employeeId, empAssignments] of grouped) {
      const employee = employeesMap.get(employeeId)
      if (!employee || !employee.email) {
        skipped++
        continue
      }

      const myAssignmentKeys = new Set(empAssignments.map(a => `${a.date}_${a.shift_id}_${a.employee_id}`))

      // Build full branch calendar HTML
      let calendarHtml = ''
      for (const date of dates) {
        const d = new Date(date + 'T00:00:00')
        const dayName = hebrewDays[d.getDay()] || ''
        const dateStr = date.split('-').reverse().slice(0, 2).join('/')

        calendarHtml += `<h3 style="color: #1e293b; font-size: 14px; margin: 16px 0 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">יום ${dayName} ${dateStr}</h3>`

        const dateShifts = shiftsByDate.get(date)
        if (!dateShifts) continue

        for (const [shiftId, shiftAssigns] of dateShifts) {
          const shift = shiftsMap.get(shiftId)
          const startTime = shift?.start_time?.slice(0, 5) || ''
          const endTime = shift?.end_time?.slice(0, 5) || ''

          calendarHtml += `<table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px; border: 1px solid #e2e8f0; border-radius: 6px;">`
          calendarHtml += `<tr style="background: #eef2ff;"><td colspan="2" style="padding: 6px 10px; font-weight: 700; color: #3730a3; font-size: 13px;">${shift?.name || ''} (${startTime}–${endTime})</td></tr>`

          for (const sa of shiftAssigns) {
            const emp = employeesMap.get(sa.employee_id)
            const role = sa.role_id ? rolesMap.get(sa.role_id) : null
            const isMe = myAssignmentKeys.has(`${sa.date}_${sa.shift_id}_${sa.employee_id}`)
            const bgColor = isMe ? '#e0e7ff' : 'white'

            calendarHtml += `<tr style="background: ${bgColor};"><td style="padding: 5px 10px; border-bottom: 1px solid #f1f5f9; color: #64748b; width: 40%;">${role?.name || ''}</td><td style="padding: 5px 10px; border-bottom: 1px solid #f1f5f9; font-weight: ${isMe ? '700' : '400'}; color: #1e293b;">${emp?.name || '?'}${isMe ? ' ⬅️' : ''}</td></tr>`
          }
          calendarHtml += '</table>'
        }
      }

      const html = `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px; background: #f8fafc; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0d6165; font-size: 36px; margin: 0; font-family: serif; font-weight: 900; letter-spacing: 2px;">מרטין</h1>
            <p style="color: #0d6165; font-size: 12px; margin: 4px 0 0; letter-spacing: 3px;">קונדיטוריה ובית מאפה · 1964</p>
          </div>
          <div style="background: white; border-radius: 10px; padding: 24px; border: 1px solid #e2e8f0;">
            <p style="color: #0f172a; font-size: 16px; margin: 0 0 8px;">שלום ${employee.name}!</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.7; margin: 0 0 8px;">
              סידור העבודה לשבוע ${week_start} פורסם.
            </p>
            <p style="color: #6366f1; font-size: 13px; font-weight: 600; margin: 0 0 16px;">
              💡 המשמרות שלך מסומנות בכחול
            </p>
            ${calendarHtml}
            <p style="color: #334155; font-size: 14px; margin: 16px 0 0;">
              <a href="https://martin-bakery.vercel.app" style="color: #2563eb;">לצפייה במערכת</a>
            </p>
            <p style="color: #64748b; font-size: 14px; margin: 20px 0 0;">
              בברכה,<br/>
              <strong>צוות קונדיטוריית מרטין</strong>
            </p>
          </div>
        </div>
      `

      const subject = `סידור עבודה שבוע ${week_start} — קונדיטוריית מרטין 📅`

      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: 'קונדיטוריית מרטין <reports@martin-bakery.co.il>',
          to: [employee.email],
          subject,
          html,
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        console.error(`Resend error for ${employee.email}:`, response.status, err)
      } else {
        sent++
        console.log(`Schedule email sent to ${employee.email}`)
      }
    }

    return new Response(JSON.stringify({ sent, skipped }), {
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
