import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const db = createClient(supabaseUrl, serviceKey)

    const now = new Date()

    // Fetch due scheduled messages
    const { data: dueMessages } = await db.from('scheduled_messages')
      .select('*')
      .eq('is_active', true)
      .lte('next_send_at', now.toISOString())

    if (!dueMessages || dueMessages.length === 0) {
      return json({ status: 'ok', sent: 0 })
    }

    let totalSent = 0

    for (const sched of dueMessages) {
      // Create the actual message in branch_messages
      const { data: msg } = await db.from('branch_messages').insert({
        branch_id: sched.branch_id,
        title: sched.title,
        body: sched.body,
        type: sched.type,
        recipient_type: sched.recipient_type,
        recipient_id: sched.recipient_id,
        recipient_role: sched.recipient_role,
        created_by: `${sched.created_by || ''} (אוטומטי)`,
        is_pinned: false,
      }).select().single()

      // Count recipients
      let recipientsCount = 0
      if (sched.recipient_type === 'specific') {
        recipientsCount = 1
      } else {
        const { count } = await db.from('branch_employees')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', sched.branch_id).eq('active', true).eq('is_manager', false)
        recipientsCount = count || 0
      }

      // Log the send
      await db.from('scheduled_message_log').insert({
        scheduled_message_id: sched.id,
        recipients_count: recipientsCount,
        reads_count: 0,
      })

      // Calculate next_send_at
      let nextSend: string | null = null
      if (sched.schedule_type === 'weekly' || sched.schedule_type === 'biweekly') {
        const increment = sched.schedule_type === 'biweekly' ? 14 : 7
        const daysOfWeek: number[] = sched.days_of_week || []
        if (daysOfWeek.length > 0) {
          // Find next matching day
          for (let i = 1; i <= increment; i++) {
            const d = new Date(now)
            d.setDate(d.getDate() + i)
            if (daysOfWeek.includes(d.getDay())) {
              const [h, m] = (sched.send_time || '07:00').split(':').map(Number)
              d.setHours(h, m, 0, 0)
              nextSend = d.toISOString()
              break
            }
          }
        }
      } else if (sched.schedule_type === 'monthly') {
        const next = new Date(now)
        next.setMonth(next.getMonth() + 1)
        next.setDate(28)
        const [h, m] = (sched.send_time || '07:00').split(':').map(Number)
        next.setHours(h, m, 0, 0)
        nextSend = next.toISOString()
      }
      // 'once' → deactivate

      await db.from('scheduled_messages').update({
        last_sent_at: now.toISOString(),
        next_send_at: nextSend,
        is_active: sched.schedule_type !== 'once',
      }).eq('id', sched.id)

      totalSent++
    }

    return json({ status: 'ok', sent: totalSent })
  } catch (err) {
    console.error('Error:', err)
    return json({ error: String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
