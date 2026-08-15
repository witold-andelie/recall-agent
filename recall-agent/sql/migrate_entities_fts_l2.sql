-- Entities + language-agnostic FTS + L2 calibration views.
-- One statement per implicit transaction (CRDB schema-change guidance).

CREATE TYPE entity_kind AS ENUM (
  'person',
  'org',
  'place',
  'other'
);

CREATE TABLE IF NOT EXISTS entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          entity_kind NOT NULL,
  name          STRING NOT NULL,
  name_norm     STRING NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, name_norm)
);

CREATE INDEX IF NOT EXISTS entities_user_kind_idx
  ON entities (user_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_entities (
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  memory_id     UUID NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  entity_id     UUID NOT NULL REFERENCES entities (id) ON DELETE CASCADE,
  confidence    FLOAT8 NOT NULL DEFAULT 1.0
                  CHECK (confidence >= 0 AND confidence <= 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_id, entity_id)
);

CREATE INDEX IF NOT EXISTS memory_entities_entity_idx
  ON memory_entities (entity_id);

CREATE INDEX IF NOT EXISTS memory_entities_user_idx
  ON memory_entities (user_id, entity_id);

SET sql_safe_updates = false;

DROP INDEX IF EXISTS memories@memories_content_tsv_gin;

ALTER TABLE memories DROP COLUMN IF EXISTS content_tsv;

ALTER TABLE memories ADD COLUMN content_tsv TSVECTOR
  AS (to_tsvector('simple', content)) STORED;

CREATE INDEX memories_content_tsv_gin
  ON memories USING GIN (content_tsv);

CREATE INDEX IF NOT EXISTS memories_user_current_tsv_idx
  ON memories (user_id)
  STORING (content_tsv)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

CREATE OR REPLACE VIEW v_entity_clusters AS
SELECT
  e.user_id,
  e.kind,
  e.name,
  count(me.memory_id) AS memory_count,
  max(me.created_at) AS last_linked_at
FROM entities e
LEFT JOIN memory_entities me ON me.entity_id = e.id
GROUP BY e.user_id, e.id, e.kind, e.name;

CREATE OR REPLACE VIEW v_l2_calibration AS
SELECT
  count(*) FILTER (WHERE action = 'SKIP') AS skip_n,
  count(*) FILTER (WHERE action = 'UPDATE') AS update_n,
  count(*) FILTER (WHERE action = 'ADD') AS add_n,
  percentile_disc(0.80) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'SKIP') AS skip_p80,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'UPDATE') AS update_p50,
  percentile_disc(0.20) WITHIN GROUP (ORDER BY sim_l2)
    FILTER (WHERE action = 'ADD') AS add_p20
FROM memory_extraction_log
WHERE sim_l2 IS NOT NULL AND sim_l2 >= 0;
