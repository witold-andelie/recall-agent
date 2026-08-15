-- Versioned memories: UPDATE expires the old row instead of clobbering.
-- One statement per implicit transaction.

ALTER TABLE memories ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS memories_user_kind_current_idx
  ON memories (user_id, kind, updated_at DESC)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS memories_user_last_used_current_idx
  ON memories (user_id, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

CREATE OR REPLACE VIEW v_memory_reuse AS
SELECT
  m.user_id,
  m.id AS memory_id,
  m.kind,
  left(m.content, 120) AS content_preview,
  m.hit_count,
  m.importance,
  m.created_at,
  m.last_used_at,
  CASE
    WHEN m.hit_count = 0 THEN 'never_used'
    WHEN m.hit_count < 3 THEN 'low'
    WHEN m.hit_count < 10 THEN 'medium'
    ELSE 'hot'
  END AS reuse_bucket,
  EXTRACT(EPOCH FROM (now() - m.created_at)) / 86400.0 AS age_days,
  CASE
    WHEN m.last_used_at IS NULL THEN NULL
    ELSE EXTRACT(EPOCH FROM (now() - m.last_used_at)) / 86400.0
  END AS days_since_use
FROM memories m
WHERE m.deleted_at IS NULL AND m.valid_to IS NULL;
