import { query, toVectorLiteral } from "@/lib/db/pool";
import type { HybridHit } from "@/lib/types";

const ALPHA = 0.55;
const BETA = 0.25;
const GAMMA = 0.1;
const DELTA = 0.1;

/**
 * P3 / P16 — hybrid retrieval in one SQL round-trip:
 * ANN binds $1/$2 directly (not via CTE join). A vector-index hint inside
 * a larger CTE that reads q.q_emb is rejected by CRDB. Soft-delete / null
 * embedding are filtered after over-fetch.
 */
export async function hybridRetrieve(opts: {
  userId: string;
  queryEmbedding: number[];
  queryText: string;
  limit?: number;
}): Promise<HybridHit[]> {
  const k = opts.limit ?? 8;
  const vec = toVectorLiteral(opts.queryEmbedding);

  const { rows } = await query<HybridHit>(
    `
    WITH q AS (
      SELECT
        $1::uuid AS user_id,
        $2::vector AS q_emb,
        plainto_tsquery('simple', $3) AS q_ts,
        $4::int AS k
    ),
    vec_ann AS (
      SELECT
        m.id,
        (1.0 / (1.0 + (m.embedding <-> $2::vector))) AS score_vec
      FROM memories@memories_user_embedding_vec_idx AS m
      WHERE m.user_id = $1::uuid
      ORDER BY m.embedding <-> $2::vector
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
        ts_rank(m.content_tsv, q.q_ts)::float8 AS score_txt
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
        m.created_at,
        m.updated_at,
        m.source_message_id,
        m.source_thread_id,
        m.valid_to,
        COALESCE(v.score_vec, 0.0)::float8 AS score_vec,
        COALESCE(t.score_txt, 0.0)::float8 AS score_txt,
        exp(
          -EXTRACT(EPOCH FROM (now() - COALESCE(m.last_used_at, m.created_at)))
          / 86400.0 / 14.0
        )::float8 AS score_recency,
        (ln(1.0 + m.hit_count::float8) / ln(51.0))::float8 AS score_usage
      FROM memories m
      LEFT JOIN vec v ON v.id = m.id
      LEFT JOIN txt t ON t.id = m.id
      WHERE m.user_id = $1::uuid
        AND m.deleted_at IS NULL
        AND m.valid_to IS NULL
        AND (v.id IS NOT NULL OR t.id IS NOT NULL)
    ),
    ent_seed AS (
      SELECT DISTINCT me.entity_id
      FROM memory_entities me
      INNER JOIN fused f ON f.id = me.memory_id
      WHERE me.user_id = $1::uuid
    ),
    ent_extra AS (
      SELECT
        m.id,
        m.user_id,
        m.kind,
        m.content,
        m.importance,
        m.hit_count,
        m.last_used_at,
        m.created_at,
        m.updated_at,
        m.source_message_id,
        m.source_thread_id,
        m.valid_to,
        COALESCE(v.score_vec, 0.0)::float8 AS score_vec,
        COALESCE(t.score_txt, 0.0)::float8 AS score_txt,
        exp(
          -EXTRACT(EPOCH FROM (now() - COALESCE(m.last_used_at, m.created_at)))
          / 86400.0 / 14.0
        )::float8 AS score_recency,
        (ln(1.0 + m.hit_count::float8) / ln(51.0))::float8 AS score_usage,
        0.22::float8 AS score_entity
      FROM memory_entities me
      INNER JOIN ent_seed s ON s.entity_id = me.entity_id
      INNER JOIN memories m ON m.id = me.memory_id
      LEFT JOIN vec v ON v.id = m.id
      LEFT JOIN txt t ON t.id = m.id
      WHERE m.user_id = $1::uuid
        AND m.deleted_at IS NULL
        AND m.valid_to IS NULL
        AND NOT EXISTS (SELECT 1 FROM fused f WHERE f.id = m.id)
    ),
    scored AS (
      SELECT
        f.*,
        0.0::float8 AS score_entity
      FROM fused f
      UNION ALL
      SELECT e.* FROM ent_extra e
    )
    SELECT
      s.*,
      (
        ${ALPHA} * s.score_vec
        + ${BETA} * s.score_txt
        + ${GAMMA} * s.score_recency
        + ${DELTA} * s.score_usage
        + 0.12 * s.score_entity
      )::float8 AS hybrid_score
    FROM scored s
    ORDER BY hybrid_score DESC
    LIMIT $4::int
    `,
    [opts.userId, vec, opts.queryText, k],
  );

  return rows;
}

/** Record hits + usage events after retrieval (P3 side effects). */
export async function recordMemoryHits(opts: {
  userId: string;
  threadId: string | null;
  messageId: string | null;
  hits: HybridHit[];
}): Promise<void> {
  if (!opts.hits.length) return;

  const ids = opts.hits.map((h) => h.id);
  await query(
    `
    UPDATE memories AS m
    SET hit_count = m.hit_count + 1,
        last_used_at = now(),
        updated_at = now()
    WHERE m.user_id = $1::uuid
      AND m.id = ANY($2::uuid[])
    `,
    [opts.userId, ids],
  );

  for (const h of opts.hits) {
    await query(
      `
      INSERT INTO memory_usage_events (
        user_id, memory_id, thread_id, message_id,
        score_vec, score_txt, score_recency, score_usage, hybrid_score
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        opts.userId,
        h.id,
        opts.threadId,
        opts.messageId,
        h.score_vec,
        h.score_txt,
        h.score_recency,
        h.score_usage,
        h.hybrid_score,
      ],
    );
  }
}

export function formatMemoriesForPrompt(hits: HybridHit[]): string {
  if (!hits.length) {
    return "No long-term memories retrieved for this turn.";
  }
  return hits
    .map(
      (h, i) =>
        `${i + 1}. [${h.kind}${h.score_entity ? "+entity" : ""}] (score=${h.hybrid_score.toFixed(3)}) ${h.content}`,
    )
    .join("\n");
}
