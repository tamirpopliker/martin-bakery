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

// Pinned, and via npm: rather than esm.sh.
//
// `https://esm.sh/@supabase/supabase-js@2` floats to whatever is newest. On
// 2026-08-04 that became 2.112.2, whose postgrest-js sub-module esm.sh had
// not built, and every deploy failed on a release nothing here asked for.
// npm: is resolved by Deno itself, so there is no third-party build step in
// the path, and the pin means a new release cannot break a deploy again.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.98.0'
export type { SupabaseClient }

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

/**
 * Who the request acts as.
 *
 * `effectiveRole` and `lockedBranch` — not `user.role` and `user.branch_id` —
 * are what every permission decision reads. They differ only when an admin is
 * simulating a lower role in order to test it.
 *
 * `lockedBranch` is the important one. For an admin it is null: the branch is
 * an argument they supply. For a branch user it is their own branch, and the
 * argument is ignored — a branch is part of who you are, not something you ask
 * for.
 */
export interface AgentIdentity {
  user: AppUser
  effectiveRole: string
  lockedBranch: number | null
  restricted: boolean
  simulating: boolean
}

export type AuthResult =
  | { ok: true; identity: AgentIdentity; db: SupabaseClient }
  | { ok: false; status: number; error: string }

/** Roles the agent is open to. Adding one here is the whole rollout switch. */
const ENABLED_ROLES = ['admin', 'branch']

const USERNAME_AUTH_DOMAIN = '@martin.local'

/** Mirrors src/lib/UserContext.tsx::isRestrictedBranchUser. */
function isRestricted(role: string, email: string): boolean {
  return role === 'branch' && email.toLowerCase().endsWith(USERNAME_AUTH_DOMAIN)
}

export interface Simulation { role?: string; branch_id?: number }

/**
 * Builds the identity, applying a simulation only if it strictly reduces
 * access. An admin may act as a branch user to test; nobody may act as an
 * admin, and a branch user may not switch branch.
 */
export function resolveIdentity(user: AppUser, sim?: Simulation): AgentIdentity {
  const base: AgentIdentity = {
    user,
    effectiveRole: user.role,
    lockedBranch: user.role === 'admin' ? null : user.branch_id,
    restricted: isRestricted(user.role, user.email),
    simulating: false,
  }

  if (!sim?.role || user.role !== 'admin') return base
  if (sim.role === 'admin') return base   // never an upgrade

  return {
    user,
    effectiveRole: sim.role,
    lockedBranch: sim.branch_id ?? null,
    restricted: false,
    simulating: true,
  }
}

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
export async function authenticateAgentRequest(req: Request, sim?: Simulation): Promise<AuthResult> {
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
  // Two independent checks. The flag alone never grants access, and the role
  // alone never does either.
  if (!user.agent_enabled) {
    return { ok: false, status: 403, error: 'הסוכן אינו זמין עבור המשתמש הזה' }
  }
  if (!ENABLED_ROLES.includes(user.role)) {
    return { ok: false, status: 403, error: 'הסוכן אינו זמין לתפקיד הזה' }
  }
  // Restricted @martin.local logins are shared shop-floor accounts. Until
  // "who is speaking" has an answer, they do not get to write anything.
  if (isRestricted(user.role, user.email)) {
    return { ok: false, status: 403, error: 'הסוכן אינו זמין למשתמש משותף' }
  }
  if (user.role !== 'admin' && user.branch_id == null) {
    return { ok: false, status: 403, error: 'למשתמש לא משויך סניף' }
  }

  return { ok: true, identity: resolveIdentity(user as AppUser, sim), db }
}
