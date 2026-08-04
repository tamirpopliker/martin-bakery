// ═══════════════════════════════════════════════════════════════════════
// Auth + access gate for the voice agent edge functions.
//
// Used by BOTH `transcribe` and `agent`. The gate runs before anything
// else — before transcription, before loading the tool catalog, before any
// query. Without it, anyone holding a token could use us as a free
// transcription service on our own OpenAI bill.
//
// The client never tells us who it is. We read the JWT, ask Supabase Auth
// who it belongs to, and look the user up ourselves.
//
// Phase 1 = admin only. See AGENT_PLAN.md section 3.1.
// ═══════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export interface AppUser {
  id: string
  email: string
  name: string
  role: string
  branch_id: number | null
  agent_enabled: boolean
}

export type AuthResult =
  | { ok: true; user: AppUser; db: SupabaseClient }
  | { ok: false; status: number; error: string }

/** JSON response with CORS headers applied. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Verifies the caller and enforces the phase-1 gate.
 *
 * Two independent checks — `agent_enabled` AND `role === 'admin'`. Flipping
 * the flag alone can never grant access to a non-admin, and vice versa.
 *
 * Returns a service-role client for DB work. In phase 2 reads should move to
 * a client carrying the user's JWT so RLS applies (AGENT_PLAN.md 3.5).
 */
export async function authenticateAgentRequest(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'נדרשת התחברות' }
  }

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !anonKey || !serviceKey) {
    console.error('[agentAuth] missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY')
    return { ok: false, status: 500, error: 'תקלת הגדרות בשרת' }
  }

  // Resolve the token → auth user. The anon client is only used for this.
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: authData, error: authError } = await authClient.auth.getUser()
  if (authError || !authData?.user) {
    return { ok: false, status: 401, error: 'ההתחברות פגה, יש להתחבר מחדש' }
  }

  const db = createClient(url, serviceKey)

  const { data: user, error: userError } = await db
    .from('app_users')
    .select('id, email, name, role, branch_id, agent_enabled')
    .eq('auth_uid', authData.user.id)
    .maybeSingle()

  if (userError) {
    console.error('[agentAuth] app_users lookup failed:', userError.message)
    return { ok: false, status: 500, error: 'תקלה בזיהוי המשתמש' }
  }
  if (!user) {
    return { ok: false, status: 403, error: 'המשתמש אינו רשום במערכת' }
  }

  // ── The gate ──
  if (!user.agent_enabled) {
    return { ok: false, status: 403, error: 'הסוכן אינו זמין עבור המשתמש הזה' }
  }
  if (user.role !== 'admin') {
    return { ok: false, status: 403, error: 'הסוכן זמין כרגע למנהלי מערכת בלבד' }
  }

  return { ok: true, user: user as AppUser, db }
}
