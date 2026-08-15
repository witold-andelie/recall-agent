-- =============================================================================
-- Recall Agent — schema_v3.sql
-- Maps 1:1 to infra_v3 (SD0 objects + SD1/P3/P7/P8 + SD4 SQL surface)
--
-- Target: CockroachDB Serverless / self-hosted 25.2+ (VECTOR index preview)
-- Dialect: PostgreSQL-compatible (pgvector ops + TSVECTOR / ts_rank)
--
-- Product language: English-only agent surface (UI, prompts, memory content).
-- This file is schema + demo SQL for judges / implementation — not product copy.
--
-- CRDB SQL/schema work must follow official Agent Skills:
--   vendor/cockroachdb-skills  (cockroachlabs/cockroachdb-skills)
--   primary: cockroachdb-sql  (EXPLAIN every generated statement)
--
-- CRDB notes (as of vector index docs):
--   * Enable: SET CLUSTER SETTING feature.vector_index.enabled = true;
--   * Vector indexes accelerate L2 distance only: operator <->
--   * Prefix columns (user_id) pre-filter ANN search — required for tenant-safe
--     index use: WHERE user_id = $1 ORDER BY embedding <-> $q
--   * FTS: TSVECTOR + GIN / inverted index; to_tsvector config must be explicit
--     on computed columns / expression indexes.
-- =============================================================================

-- Optional: run once per cluster (requires privileges)
-- SET CLUSTER SETTING feature.vector_index.enabled = true;

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE memory_kind AS ENUM (
  'preference',
  'fact',
  'task_state'
);

CREATE TYPE memory_link_rel AS ENUM (
  'supersedes',
  'duplicates',
  'derived_from'
);

CREATE TYPE dedupe_action AS ENUM (
  'ADD',
  'UPDATE',
  'SKIP'
);

CREATE TYPE message_role AS ENUM (
  'user',
  'assistant',
  'system'
);

-- ---------------------------------------------------------------------------
-- Auth / session (SD2 P9)
-- Anonymous trial still gets a stable user_id for tenant scoping.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  STRING,
  -- Nullable so Guest rows stay email-less. Claim/register fills these.
  email         STRING,
  password_hash BYTES,
  is_anonymous  BOOL NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email IS NULL OR email = lower(email))
);

-- Multiple NULL emails are allowed; claimed accounts are unique by email.
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE email IS NOT NULL;

CREATE TABLE auth_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    BYTES NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);

-- ---------------------------------------------------------------------------
-- Threads & messages (conversation control + source lineage)
-- ---------------------------------------------------------------------------

CREATE TABLE threads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title         STRING NOT NULL DEFAULT 'New chat',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX threads_user_updated_idx
  ON threads (user_id, updated_at DESC);

CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     UUID NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role          message_role NOT NULL,
  content       STRING NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Optional token / model metadata for analytics
  model_id      STRING,
  token_count   INT
);

CREATE INDEX messages_thread_created_idx
  ON messages (thread_id, created_at);

CREATE INDEX messages_user_created_idx
  ON messages (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Memory fact table (SD0 Memory) — ops + vector + full-text in one row
-- P8: row + embedding + content_tsv written in a single transaction.
-- ---------------------------------------------------------------------------

CREATE TABLE memories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  kind                memory_kind NOT NULL,
  content             STRING NOT NULL,          -- English text (product surface)
  -- Stored computed FTS document (english). Must name config for CRDB.
  content_tsv         TSVECTOR AS (to_tsvector('english', content)) STORED,

  -- Bedrock Titan / gateway embedding; 1024-d matches infra_v3 EmbedModel
  embedding           VECTOR(1024),

  importance          FLOAT8 NOT NULL DEFAULT 0.5
                        CHECK (importance >= 0 AND importance <= 1),
  hit_count           INT NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Lineage back to the turn that produced this memory (P6/P8)
  source_message_id   UUID REFERENCES messages (id) ON DELETE SET NULL,
  source_thread_id    UUID REFERENCES threads (id) ON DELETE SET NULL,

  -- Soft delete for audit-friendly forget (P12)
  deleted_at          TIMESTAMPTZ,

  -- UPDATE expires the old row (valid_to) and inserts a successor.
  -- Current facts: deleted_at IS NULL AND valid_to IS NULL.
  valid_to            TIMESTAMPTZ
);

-- Tenant + recency browse (current versions only)
CREATE INDEX memories_user_kind_updated_idx
  ON memories (user_id, kind, updated_at DESC)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

CREATE INDEX memories_user_last_used_idx
  ON memories (user_id, last_used_at DESC NULLS LAST)
  WHERE deleted_at IS NULL AND valid_to IS NULL;

CREATE INDEX memories_source_message_idx
  ON memories (source_message_id)
  WHERE source_message_id IS NOT NULL;

-- Full-text index (GIN / inverted) — SD0 FullTextIndex
CREATE INDEX memories_content_tsv_gin
  ON memories USING GIN (content_tsv);

-- Distributed vector index with user_id prefix — SD0 VectorIndex / CRDB tool ①
-- Only L2 (<->) is index-accelerated; hybrid SQL below uses the same operator.
CREATE VECTOR INDEX memories_user_embedding_vec_idx
  ON memories (user_id, embedding);

-- ---------------------------------------------------------------------------
-- Memory graph (SD0 MemoryLink) — P7 dedupe / supersede
-- ---------------------------------------------------------------------------

CREATE TABLE memory_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  from_id       UUID NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  to_id         UUID NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  rel           memory_link_rel NOT NULL,
  confidence    FLOAT8 NOT NULL DEFAULT 1.0
                  CHECK (confidence >= 0 AND confidence <= 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_id, to_id, rel),
  CHECK (from_id <> to_id)
);

CREATE INDEX memory_links_user_rel_idx
  ON memory_links (user_id, rel);

CREATE INDEX memory_links_to_id_idx
  ON memory_links (to_id);

-- ---------------------------------------------------------------------------
-- Retrieval analytics events (SD0 MemoryUsageEvent) — P3 side effect
-- ---------------------------------------------------------------------------

CREATE TABLE memory_usage_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  memory_id       UUID NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
  thread_id       UUID REFERENCES threads (id) ON DELETE SET NULL,
  message_id      UUID REFERENCES messages (id) ON DELETE SET NULL,

  score_vec       FLOAT8,   -- higher = better (normalized from L2)
  score_txt       FLOAT8,   -- ts_rank
  score_recency   FLOAT8,
  score_usage     FLOAT8,
  hybrid_score    FLOAT8 NOT NULL,

  used_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_usage_events_user_used_idx
  ON memory_usage_events (user_id, used_at DESC);

CREATE INDEX memory_usage_events_memory_used_idx
  ON memory_usage_events (memory_id, used_at DESC);

-- ---------------------------------------------------------------------------
-- Extraction / dedupe audit (supports v_memory_funnel ADD|UPDATE|SKIP)
-- Optional but recommended for judge demo of P6→P7
-- ---------------------------------------------------------------------------

CREATE TABLE memory_extraction_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  thread_id         UUID REFERENCES threads (id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages (id) ON DELETE SET NULL,

  candidate_content STRING NOT NULL,
  candidate_kind    memory_kind NOT NULL,
  action            dedupe_action NOT NULL,
  matched_memory_id UUID REFERENCES memories (id) ON DELETE SET NULL,
  sim_l2            FLOAT8,          -- L2 distance to nearest neighbor (if any)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX memory_extraction_log_user_created_idx
  ON memory_extraction_log (user_id, created_at DESC);

CREATE INDEX memory_extraction_log_action_idx
  ON memory_extraction_log (action, created_at DESC);

COMMIT;

-- =============================================================================
-- P16 — Hybrid retrieve (single-statement CTE fusion)
-- Weights (defaults; tune in app): α vec 0.55 · β txt 0.25 · γ recency 0.10 · δ hits 0.10
--
-- Parameters (bind from app):
--   $1::UUID          user_id          — tenant scope (required for vector index prefix)
--   $2::VECTOR(1024)  query embedding
--   $3::STRING        query text       — for plainto_tsquery
--   $4::INT           limit            — top-K (e.g. 8)
--
-- Score_vec: convert L2 distance d to similarity in (0,1]:  1 / (1 + d)
-- Recency:   exp(-age_days / 14)
-- Usage:     ln(1 + hit_count) / ln(1 + max_hits_cap)  with cap=50 for stability
-- =============================================================================

-- Example (replace $n with literals or use PREPARE):
/*
PREPARE hybrid_retrieve (UUID, VECTOR(1024), STRING, INT) AS
WITH q AS (
  SELECT
    $1::UUID              AS user_id,
    $2::VECTOR(1024)      AS q_emb,
    plainto_tsquery('english', $3) AS q_ts,
    $4::INT               AS k
),
vec_ann AS (
  SELECT
    m.id,
    (1.0 / (1.0 + (m.embedding <-> $2::VECTOR(1024)))) AS score_vec
  FROM memories@memories_user_embedding_vec_idx AS m
  WHERE m.user_id = $1::UUID
  ORDER BY m.embedding <-> $2::VECTOR(1024)
  LIMIT 80
),
vec AS (
  SELECT a.id, a.score_vec
  FROM vec_ann a
  INNER JOIN memories m ON m.id = a.id
  WHERE m.deleted_at IS NULL
    AND m.valid_to IS NULL
    AND m.embedding IS NOT NULL
),
txt AS (
  SELECT
    m.id,
    ts_rank(m.content_tsv, q.q_ts) AS score_txt
  FROM memories m, q
  WHERE m.user_id = q.user_id
    AND m.deleted_at IS NULL
    AND m.valid_to IS NULL
    AND m.content_tsv @@ q.q_ts
  ORDER BY score_txt DESC
  LIMIT 50
),
fused AS (
  SELECT
    m.id,
    m.user_id,
    m.kind,
    m.content,
    m.importance,
    m.hit_count,
    m.last_used_at,
    m.source_message_id,
    COALESCE(v.score_vec, 0.0) AS score_vec,
    COALESCE(t.score_txt, 0.0) AS score_txt,
    exp(
      -EXTRACT(EPOCH FROM (now() - COALESCE(m.last_used_at, m.created_at)))
      / 86400.0 / 14.0
    ) AS score_recency,
    ln(1.0 + m.hit_count) / ln(1.0 + 50.0) AS score_usage
  FROM memories m
  LEFT JOIN vec v ON v.id = m.id
  LEFT JOIN txt t ON t.id = m.id
  WHERE m.user_id = (SELECT user_id FROM q)
    AND m.deleted_at IS NULL
    AND m.valid_to IS NULL
    AND (v.id IS NOT NULL OR t.id IS NOT NULL)
)
SELECT
  f.*,
  (0.55 * f.score_vec
 + 0.25 * f.score_txt
 + 0.10 * f.score_recency
 + 0.10 * f.score_usage) AS hybrid_score
FROM fused f
ORDER BY hybrid_score DESC
LIMIT $4::INT;
*/

-- Runtime hit bookkeeping (call after returning top-K to the model):
/*
BEGIN;
  UPDATE memories AS m
  SET hit_count    = m.hit_count + 1,
      last_used_at = now(),
      updated_at   = now()
  FROM (SELECT unnest($1::UUID[]) AS id) AS x
  WHERE m.id = x.id AND m.user_id = $2::UUID;

  INSERT INTO memory_usage_events (
    user_id, memory_id, thread_id, message_id,
    score_vec, score_txt, score_recency, score_usage, hybrid_score
  )
  SELECT
    $2::UUID,
    r.memory_id,
    $3::UUID,
    $4::UUID,
    r.score_vec, r.score_txt, r.score_recency, r.score_usage, r.hybrid_score
  FROM unnest(
    $5::UUID[], $6::FLOAT8[], $7::FLOAT8[], $8::FLOAT8[], $9::FLOAT8[], $10::FLOAT8[]
  ) AS r(memory_id, score_vec, score_txt, score_recency, score_usage, hybrid_score);
COMMIT;
*/

-- =============================================================================
-- P17 — Dedupe near-neighbor (SQL decides; LLM only proposes candidates)
-- Thresholds (suggested):
--   d < 0.25  → SKIP or UPDATE (near-duplicate; L2 scale depends on embedding)
--   0.25–0.55 → UPDATE / supersedes (related)
--   d > 0.55  → ADD
-- Calibrate on your embedding model with a small labeled set.
-- =============================================================================

/*
-- Nearest existing memories (ANN on vector index, then filter kind / deleted)
WITH ann AS (
  SELECT
    m.id,
    (m.embedding <-> $2::VECTOR(1024)) AS l2_dist
  FROM memories@memories_user_embedding_vec_idx AS m
  WHERE m.user_id = $1::UUID
  ORDER BY m.embedding <-> $2::VECTOR(1024)
  LIMIT 20
)
SELECT a.id, m.kind, m.content, a.l2_dist
FROM ann a
INNER JOIN memories m ON m.id = a.id
WHERE m.deleted_at IS NULL
  AND m.valid_to IS NULL
  AND m.kind = $3::memory_kind
ORDER BY a.l2_dist
LIMIT 5;
*/

/*
-- Example single-TX ADD with optional duplicate link (app sets action)
BEGIN;

  -- INSERT new memory (ADD path)
  INSERT INTO memories (
    user_id, kind, content, embedding, importance,
    source_message_id, source_thread_id
  ) VALUES (
    $1, $2::memory_kind, $3, $4::VECTOR(1024), $5,
    $6, $7
  )
  RETURNING id;

  -- If near-duplicate of existing $old_id:
  -- INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
  -- VALUES ($1, $new_id, $old_id, 'duplicates', $conf);

  -- If superseding $old_id (do not clobber):
  -- UPDATE memories SET valid_to = now(), updated_at = now()
  -- WHERE id = $old_id AND user_id = $1 AND valid_to IS NULL;
  -- INSERT new row, then:
  -- INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
  -- VALUES ($1, $new_id, $old_id, 'supersedes', $conf);

  INSERT INTO memory_extraction_log (
    user_id, thread_id, source_message_id,
    candidate_content, candidate_kind, action, matched_memory_id, sim_l2
  ) VALUES (
    $1, $7, $6, $3, $2::memory_kind, $action::dedupe_action, $matched_id, $l2
  );

COMMIT;
*/

-- =============================================================================
-- SD4 — Analytics views (judge demo + SQL interview surface)
-- =============================================================================

-- Daily funnel: messages → extractions → ADD / UPDATE / SKIP
CREATE OR REPLACE VIEW v_memory_funnel AS
WITH msg AS (
  SELECT
    user_id,
    date_trunc('day', created_at) AS day,
    count(*) AS messages
  FROM messages
  WHERE role = 'user'
  GROUP BY 1, 2
),
ext AS (
  SELECT
    user_id,
    date_trunc('day', created_at) AS day,
    count(*) AS extractions,
    count(*) FILTER (WHERE action = 'ADD')    AS add_n,
    count(*) FILTER (WHERE action = 'UPDATE') AS update_n,
    count(*) FILTER (WHERE action = 'SKIP')   AS skip_n
  FROM memory_extraction_log
  GROUP BY 1, 2
)
SELECT
  COALESCE(m.user_id, e.user_id) AS user_id,
  COALESCE(m.day, e.day)         AS day,
  COALESCE(m.messages, 0)        AS messages,
  COALESCE(e.extractions, 0)     AS extractions,
  COALESCE(e.add_n, 0)           AS add_n,
  COALESCE(e.update_n, 0)        AS update_n,
  COALESCE(e.skip_n, 0)          AS skip_n,
  CASE
    WHEN COALESCE(m.messages, 0) = 0 THEN NULL
    ELSE COALESCE(e.extractions, 0)::FLOAT8 / m.messages
  END AS extract_per_user_msg,
  CASE
    WHEN COALESCE(e.extractions, 0) = 0 THEN NULL
    ELSE e.add_n::FLOAT8 / e.extractions
  END AS add_rate
FROM msg m
FULL OUTER JOIN ext e
  ON m.user_id = e.user_id AND m.day = e.day;

-- Memory reuse / long-tail (which memories actually fire)
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

-- Hybrid score component breakdown from usage events
CREATE OR REPLACE VIEW v_hybrid_score_breakdown AS
SELECT
  user_id,
  date_trunc('day', used_at) AS day,
  count(*) AS retrieval_hits,
  avg(score_vec)     AS avg_score_vec,
  avg(score_txt)     AS avg_score_txt,
  avg(score_recency) AS avg_score_recency,
  avg(score_usage)   AS avg_score_usage,
  avg(hybrid_score)  AS avg_hybrid_score,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY hybrid_score) AS p50_hybrid,
  percentile_disc(0.90) WITHIN GROUP (ORDER BY hybrid_score) AS p90_hybrid
FROM memory_usage_events
GROUP BY 1, 2;

-- Duplicate / supersede cluster sizes via links
CREATE OR REPLACE VIEW v_duplicate_clusters AS
SELECT
  user_id,
  rel,
  count(*) AS edge_count,
  count(DISTINCT from_id) AS distinct_from,
  count(DISTINCT to_id)   AS distinct_to,
  avg(confidence)         AS avg_confidence
FROM memory_links
GROUP BY user_id, rel;

-- =============================================================================
-- Optional: judge / MCP demo snippets
-- =============================================================================

/*
-- EXPLAIN hybrid path (run via Managed MCP read-only or SQL shell)
EXPLAIN
SELECT id, content, (embedding <-> $q) AS l2
FROM memories@memories_user_embedding_vec_idx
WHERE user_id = $uid
ORDER BY embedding <-> $q
LIMIT 8;

-- Active memories by kind
SELECT kind, count(*) AS n, avg(hit_count) AS avg_hits
FROM memories
WHERE user_id = $uid AND deleted_at IS NULL AND valid_to IS NULL
GROUP BY kind
ORDER BY n DESC;

-- Recent funnel
SELECT * FROM v_memory_funnel
WHERE user_id = $uid
ORDER BY day DESC
LIMIT 14;
*/

-- =============================================================================
-- End schema_v3
-- =============================================================================
