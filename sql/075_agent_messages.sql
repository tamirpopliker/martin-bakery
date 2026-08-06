-- 075_agent_messages.sql
--
-- Conversation history for the agent.
--
-- agent_actions only records attempts to WRITE. A manager saying "it doesn't
-- understand my questions" leaves no trace at all — the most common complaint
-- and the one with the least evidence.
--
-- One row per turn: what was said, what came back, which tools ran, how long
-- it took. Enough to separate the three failures that look identical from
-- outside — mis-heard, mis-understood, or broken.
--
-- Retention is 90 days. Long enough to see a pattern, short enough that this
-- does not quietly become a permanent archive of everything staff said.
-- Staff should be told this exists.

CREATE TABLE IF NOT EXISTS agent_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL,
  user_id         UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

  user_text       TEXT NOT NULL,
  reply_text      TEXT,
  input_mode      TEXT NOT NULL DEFAULT 'voice' CHECK (input_mode IN ('voice','text')),

  -- Which tools ran, and whether each succeeded.
  tools           JSONB,
  -- Set when the turn ended in a confirmation card rather than an answer.
  proposed_action TEXT,

  ms              INT,
  input_tokens    INT,
  output_tokens   INT,

  -- The role the turn ran as. Differs from the user's own role only when an
  -- admin was simulating, and that is worth being able to filter out.
  acted_as        TEXT,
  branch_id       INT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE agent_messages IS
  'One row per agent turn. Retained 90 days — see purge_agent_messages().';

CREATE INDEX IF NOT EXISTS idx_agent_messages_user_created
  ON agent_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation
  ON agent_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created
  ON agent_messages (created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

-- A user may read their own history; admins may read all of it. Nobody writes
-- from the client — only the edge function, via service_role.
DROP POLICY IF EXISTS "read_own_agent_messages" ON agent_messages;
CREATE POLICY "read_own_agent_messages" ON agent_messages FOR SELECT
  USING (
    user_id = (SELECT id FROM app_users WHERE auth_uid = auth.uid())
    OR EXISTS (SELECT 1 FROM app_users WHERE auth_uid = auth.uid() AND role = 'admin')
  );

-- Retention. Call from a scheduled job, or by hand.
CREATE OR REPLACE FUNCTION purge_agent_messages(p_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_deleted INT;
BEGIN
  DELETE FROM agent_messages WHERE created_at < now() - (p_days || ' days')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION purge_agent_messages IS
  'Deletes agent_messages older than p_days (default 90). Retention policy, not cleanup.';

GRANT EXECUTE ON FUNCTION purge_agent_messages TO service_role;
