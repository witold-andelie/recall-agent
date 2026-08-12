import { query, toVectorLiteral } from "@/lib/db/pool";
import type { HybridHit } from "@/lib/types";

const ALPHA = 0.55;
const BETA = 0.25;
const GAMMA = 0.1;
const DELTA = 0.1;

/**
 * P3 / P16 — hybrid retrieval in one SQL round-trip:
 * vector L2 (<->, CRDB vector-index accelerated) + ts_rank + recency + hit usage.
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
        plainto_tsquery('english', $3) AS q_ts,
        $4::int AS k
    ),
    vec AS (
      SELECT
        m.id,
        (1.0 / (1.0 + (m.embedding <-> (SELECT q_emb FROM q)))) AS score_vec
      FROM memories m, q
      WHERE m.user_id = q.user_id
        AND m.deleted_at IS NULL
        AND m.embedding IS NOT NULL
      ORDER BY m.embedding <-> q.q_emb
      LIMIT 50
    ),
    txt AS (
      SELECT
        m.id,
        ts_rank(m.content_tsv, q.q_ts)::float8 AS score_txt
      FROM memories m, q
      WHERE m.user_id = q.user_id
        AND m.deleted_at IS NULL
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
      WHERE m.user_id = (SELECT user_id FROM q)
        AND m.deleted_at IS NULL
        AND (v.id IS NOT NULL OR t.id IS NOT NULL)
    )
    SELECT
      f.*,
      (
        ${ALPHA} * f.score_vec
        + ${BETA} * f.score_txt
        + ${GAMMA} * f.score_recency
        + ${DELTA} * f.score_usage
      )::float8 AS hybrid_score
    FROM fused f
    ORDER BY hybrid_score DESC
    LIMIT (SELECT k FROM q)
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
        `${i + 1}. [${h.kind}] (score=${h.hybrid_score.toFixed(3)}) ${h.content}`,
    )
    .join("\n");
}
