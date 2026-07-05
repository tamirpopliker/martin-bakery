import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

// Provisions / resets a username-based login (username@martin.local) for a
// branch employee, so sellers can submit shift availability without a personal
// email. Mints a Supabase Auth user with the service role — therefore the
// CALLER must be verified as an admin or the employee's own branch manager.

const USERNAME_DOMAIN = '@martin.local'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    // ── 1. Authenticate the caller from their JWT ──
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return json({ error: 'חסר אימות' }, 401)

    const { data: authData, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !authData?.user) return json({ error: 'אימות נכשל' }, 401)

    const { data: caller } = await admin
      .from('app_users')
      .select('role, branch_id')
      .eq('auth_uid', authData.user.id)
      .maybeSingle()

    if (!caller || !['admin', 'branch'].includes(caller.role)) {
      return json({ error: 'אין הרשאה להקים כניסות עובדים' }, 403)
    }

    // ── 2. Parse + validate input ──
    const body = await req.json()
    const action: 'create' | 'reset' = body.action === 'reset' ? 'reset' : 'create'
    const employeeId = Number(body.employee_id)
    const rawUsername = String(body.username || '').trim().toLowerCase()
    const pin = String(body.pin || '')

    if (!employeeId) return json({ error: 'חסר מזהה עובד' }, 400)
    if (pin.length < 4) return json({ error: 'קוד הכניסה חייב להכיל לפחות 4 תווים' }, 400)
    if (action === 'create' && !/^[a-z0-9._-]{3,}$/.test(rawUsername)) {
      return json({ error: 'שם משתמש לא חוקי (אותיות לועזיות, ספרות, . _ - בלבד, 3+ תווים)' }, 400)
    }

    // ── 3. Load target employee + enforce same-branch authorization ──
    const { data: emp } = await admin
      .from('branch_employees')
      .select('id, name, branch_id, active')
      .eq('id', employeeId)
      .maybeSingle()

    if (!emp) return json({ error: 'העובד לא נמצא' }, 404)
    if (caller.role === 'branch' && caller.branch_id !== emp.branch_id) {
      return json({ error: 'אפשר להקים כניסה רק לעובדי הסניף שלך' }, 403)
    }

    // ══════════════════════════════════════════════════════════════════
    // RESET — change the PIN of an existing login
    // ══════════════════════════════════════════════════════════════════
    if (action === 'reset') {
      const { data: existing } = await admin
        .from('app_users')
        .select('auth_uid, username')
        .eq('employee_id', employeeId)
        .eq('role', 'employee')
        .maybeSingle()

      if (!existing?.auth_uid) return json({ error: 'לעובד זה אין כניסה קיימת' }, 404)

      const { error: updErr } = await admin.auth.admin.updateUserById(existing.auth_uid, {
        password: pin,
      })
      if (updErr) return json({ error: `איפוס הסיסמה נכשל: ${updErr.message}` }, 500)

      await admin.from('app_users')
        .update({ must_change_password: true })
        .eq('auth_uid', existing.auth_uid)

      return json({ success: true, action: 'reset', username: existing.username })
    }

    // ══════════════════════════════════════════════════════════════════
    // CREATE — mint a new username login
    // ══════════════════════════════════════════════════════════════════
    const email = rawUsername + USERNAME_DOMAIN

    // Username / email already taken?
    const { data: taken } = await admin
      .from('app_users')
      .select('id')
      .or(`email.eq.${email},username.eq.${rawUsername}`)
      .maybeSingle()
    if (taken) return json({ error: 'שם המשתמש כבר תפוס' }, 409)

    // Employee already has a login?
    const { data: alreadyLinked } = await admin
      .from('app_users')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('role', 'employee')
      .maybeSingle()
    if (alreadyLinked) return json({ error: 'לעובד זה כבר קיימת כניסה' }, 409)

    // Create the auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { full_name: emp.name },
    })
    if (createErr || !created?.user) {
      return json({ error: `יצירת המשתמש נכשלה: ${createErr?.message || 'שגיאה'}` }, 500)
    }

    // Link app_users. The 032 trigger is a no-op here (no branch_employees row
    // carries an @martin.local email), so we own the row. Upsert on email.
    const { error: linkErr } = await admin.from('app_users').upsert({
      email,
      username: rawUsername,
      name: emp.name,
      role: 'employee',
      branch_id: emp.branch_id,
      employee_id: employeeId,
      auth_uid: created.user.id,
      must_change_password: true,
      can_settings: false,
      excluded_departments: [],
      managed_department: null,
    }, { onConflict: 'email' })

    if (linkErr) {
      // Roll back the orphaned auth user so the manager can retry the username
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: `קישור המשתמש נכשל: ${linkErr.message}` }, 500)
    }

    return json({ success: true, action: 'create', username: rawUsername, email })
  } catch (err) {
    console.error('provision-employee-login error:', err)
    return json({ error: String(err) }, 500)
  }
})
