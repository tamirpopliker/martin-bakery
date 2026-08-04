-- 071_agent.sql
-- Martin Agent — voice operations agent, phase 1 (admin only)
--
-- Adds:
--   app_users.agent_enabled   per-user access flag
--   agent_actions             audit log + pending-confirmation queue
--   agent_corrections         learned transcription corrections
--
-- Touches no existing data. Changes no existing screen.
-- See AGENT_PLAN.md sections 3.2, 7.3, 8.4.1


-- ═══════════════════════════════════════════════════════════
-- 1. Per-user access flag
-- ═══════════════════════════════════════════════════════════

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS agent_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_users.agent_enabled IS
  'Master switch for the voice agent. Default off. The edge function checks this AND role=admin '
  'independently — flipping this alone never grants access to a non-admin.';


-- ═══════════════════════════════════════════════════════════
-- 2. agent_actions — every action the agent proposes or performs
-- ═══════════════════════════════════════════════════════════
--
-- Write actions are inserted here as 'pending_confirmation' and are NOT executed.
-- The client confirms by sending only the row id back; args are re-read server-side.
-- This is what makes it impossible to approve 340 and have 34,000 written.

CREATE TABLE IF NOT EXISTS agent_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,

  tool_name       TEXT NOT NULL,
  tool_args       JSONB NOT NULL,

  status          TEXT NOT NULL DEFAULT 'pending_confirmation'
                    CHECK (status IN ('pending_confirmation','executed','rejected','failed','expired')),

  summary_he      TEXT NOT NULL,          -- exactly what was shown on the confirmation card
  transcript      TEXT,                   -- what was heard, when input was voice
  input_mode      TEXT NOT NULL DEFAULT 'voice'
                    CHECK (input_mode IN ('voice','text')),

  result_table    TEXT,                   -- table written on success
  result_id       TEXT,                   -- id of the created/updated row
  error           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_at     TIMESTAMPTZ
);

COMMENT ON TABLE agent_actions IS
  'Audit log and pending-confirmation queue for the voice agent. '
  'Rows older than 15 minutes in pending_confirmation are treated as expired.';

CREATE INDEX IF NOT EXISTS idx_agent_actions_user_created
  ON agent_actions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_actions_pending
  ON agent_actions (created_at)
  WHERE status = 'pending_confirmation';

-- Supports the phase-1 tuning queries: which transcripts led to rejections
CREATE INDEX IF NOT EXISTS idx_agent_actions_voice_status
  ON agent_actions (status, input_mode);


-- ═══════════════════════════════════════════════════════════
-- 3. agent_corrections — learning loop
-- ═══════════════════════════════════════════════════════════
--
-- Captured whenever the user edits a transcript or a proposed field value.
-- At 3 occurrences a correction is surfaced to an admin for approval.
-- Only status='active' rows are fed back into the STT prompt.
-- Manual approval is deliberate: auto-promotion would entrench a one-off mistake.

CREATE TABLE IF NOT EXISTS agent_corrections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  heard        TEXT NOT NULL,             -- what the transcription returned
  meant        TEXT NOT NULL,             -- what the user corrected it to
  context      TEXT NOT NULL,             -- 'transcript' | field name

  occurrences  INT  NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','active','rejected')),

  approved_by  UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_corrections IS
  'Transcription corrections learned from user edits. Promoted to active only by explicit admin approval.';

-- The upsert target: repeat occurrences increment rather than duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_corrections_pair
  ON agent_corrections (heard, meant, context);

CREATE INDEX IF NOT EXISTS idx_agent_corrections_active
  ON agent_corrections (status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_agent_corrections_review
  ON agent_corrections (occurrences DESC)
  WHERE status = 'pending';


-- ═══════════════════════════════════════════════════════════
-- 4. RLS
-- ═══════════════════════════════════════════════════════════
--
-- The anon key is in the browser, so every table needs branch/user-scoped policies.
-- Both edge functions use service_role, which bypasses RLS — these policies are the
-- safety net for any direct client access, not the primary control.
--
-- Deliberately absent: INSERT/UPDATE/DELETE policies for clients on agent_actions.
-- Nothing but the edge function may create or execute an action.

ALTER TABLE agent_actions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_corrections ENABLE ROW LEVEL SECURITY;

-- agent_actions: a user reads their own history; admins read everything.
DROP POLICY IF EXISTS "read_own_agent_actions" ON agent_actions;
CREATE POLICY "read_own_agent_actions" ON agent_actions FOR SELECT
  USING (
    user_id = (SELECT id FROM app_users WHERE auth_uid = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  );

-- agent_corrections: admin-only, both for the review screen and for approving.
DROP POLICY IF EXISTS "read_agent_corrections" ON agent_corrections;
CREATE POLICY "read_agent_corrections" ON agent_corrections FOR SELECT
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "approve_agent_corrections" ON agent_corrections;
CREATE POLICY "approve_agent_corrections" ON agent_corrections FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin'));


-- ═══════════════════════════════════════════════════════════
-- 5. Enable for the phase-1 pilot user only
-- ═══════════════════════════════════════════════════════════
--
-- Three admin accounts exist. Only the pilot user is enabled.
-- To add another later:  UPDATE app_users SET agent_enabled = true WHERE email = '...';

UPDATE app_users
   SET agent_enabled = true
 WHERE email = 'tamirpopliker@gmail.com'
   AND role  = 'admin';
