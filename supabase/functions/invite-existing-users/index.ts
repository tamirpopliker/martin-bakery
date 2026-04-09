import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const usersToInvite = [
    { email: 'kobi0480@gmail.com', name: 'קובי לוי' },
    { email: 'ronvaknin5119@gmail.com', name: 'רון ווקנין' },
    { email: 'naor2708@gmail.com', name: 'נאור אורן' },
    { email: 'roztamir1976@gmail.com', name: 'תמיר רוזנברג' },
    { email: 'guyl.martin1964@gmail.com', name: 'גיא לוראן' },
    { email: 'martinbakery.beersheva@gmail.com', name: 'סידור עבודה' },
  ]

  const results: { email: string; status: string }[] = []

  for (const user of usersToInvite) {
    try {
      // Try invite first
      const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        user.email,
        {
          redirectTo: 'https://martin-bakery.vercel.app',
          data: { full_name: user.name },
        }
      )
      if (!inviteErr) {
        results.push({ email: user.email, status: '✅ הזמנה נשלחה' })
      } else if (inviteErr.message.includes('already been registered')) {
        results.push({ email: user.email, status: '✅ כבר רשום' })
      } else if (inviteErr.message.includes('Database error')) {
        // Fallback: create user directly
        const { error: createErr } = await adminClient.auth.admin.createUser({
          email: user.email,
          email_confirm: true,
          user_metadata: { full_name: user.name },
        })
        if (!createErr) {
          results.push({ email: user.email, status: '✅ נוצר ישירות' })
        } else if (createErr.message.includes('already been registered')) {
          results.push({ email: user.email, status: '✅ כבר רשום' })
        } else {
          results.push({ email: user.email, status: `שגיאה createUser: ${createErr.message}` })
        }
      } else {
        results.push({ email: user.email, status: `שגיאה: ${inviteErr.message}` })
      }
    } catch (e: any) {
      results.push({ email: user.email, status: `שגיאה: ${e?.message || e}` })
    }
  }

  // Fix missing auth_uid for users that now exist in auth
  try {
    await adminClient.rpc('fix_missing_auth_uids')
    results.push({ email: 'fix_auth_uid', status: '✅ עודכנו auth_uid חסרים' })
  } catch (e: any) {
    results.push({ email: 'fix_auth_uid', status: `שגיאה: ${e?.message || e}` })
  }

  return new Response(
    JSON.stringify({ results, total: results.length }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
})
