import { embedText } from "@/lib/ai/embed";
import { query, toVectorLiteral, withTransaction } from "@/lib/db/pool";
import type { DedupeAction, MemoryCandidate } from "@/lib/types";

/** L2 distance thresholds — calibrate per embedding model. */
export const L2_SKIP = 0.35;
export const L2_UPDATE = 0.7;

export type DedupeResult = {
  action: DedupeAction;
  memoryId: string | null;
  l2: number | null;
  content: string;
  kind: string;
  supersededId?: string | null;
};

export async function nearestLiveMemory(opts: {
  userId: string;
  embeddingLiteral: string;
  kind: string;
  excludeId?: string;
}): Promise<{ id: string; l2_dist: number } | null> {
  const { rows } = await query<{ id: string; l2_dist: number }>(
    `
    WITH ann AS (
      SELECT
        m.id,
        (m.embedding <-> $2::vector)::float8 AS l2_dist
      FROM memories@memories_user_embedding_vec_idx AS m
      WHERE m.user_id = $1::uuid
      ORDER BY m.embedding <-> $2::vector
      LIMIT 20
    )
    SELECT a.id, a.l2_dist
    FROM ann a
    INNER JOIN memories m ON m.id = a.id
    WHERE m.deleted_at IS NULL
      AND m.valid_to IS NULL
      AND m.kind = $3::memory_kind
      AND ($4::uuid IS NULL OR m.id <> $4::uuid)
    ORDER BY a.l2_dist
    LIMIT 1
    `,
    [opts.userId, opts.embeddingLiteral, opts.kind, opts.excludeId ?? null],
  );
  return rows[0] ?? null;
}

/**
 * P7 + P8 — SQL near-neighbor decides; single TX stores memory + link + log.
 * UPDATE expires the old row (valid_to) and inserts a successor + supersedes.
 */
export async function dedupeAndStore(opts: {
  userId: string;
  threadId: string;
  sourceMessageId: string;
  candidates: MemoryCandidate[];
}): Promise<DedupeResult[]> {
  const results: DedupeResult[] = [];

  for (const cand of opts.candidates) {
    const embedding = await embedText(cand.content);
    const vec = toVectorLiteral(embedding);
    const nearest = await nearestLiveMemory({
      userId: opts.userId,
      embeddingLiteral: vec,
      kind: cand.kind,
    });
    const l2 = nearest?.l2_dist ?? null;

    let action: DedupeAction = "ADD";
    if (l2 !== null && l2 < L2_SKIP) action = "SKIP";
    else if (l2 !== null && l2 < L2_UPDATE) action = "UPDATE";

    let supersededId: string | null = null;
    const memoryId = await withTransaction(async (client) => {
      let id: string | null = nearest?.id ?? null;

      if (action === "ADD") {
        const ins = await client.query<{ id: string }>(
          `
          INSERT INTO memories (
            user_id, kind, content, embedding, importance,
            source_message_id, source_thread_id
          ) VALUES ($1, $2::memory_kind, $3, $4::vector, $5, $6, $7)
          RETURNING id
          `,
          [
            opts.userId,
            cand.kind,
            cand.content,
            vec,
            cand.importance ?? 0.5,
            opts.sourceMessageId,
            opts.threadId,
          ],
        );
        id = ins.rows[0].id;

        if (nearest) {
          await client.query(
            `
            INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
            VALUES ($1, $2, $3, 'derived_from', $4)
            ON CONFLICT DO NOTHING
            `,
            [opts.userId, id, nearest.id, Math.max(0, 1 - l2!)],
          );
        }
      } else if (action === "UPDATE" && nearest) {
        const expired = await client.query<{ id: string }>(
          `
          UPDATE memories
          SET valid_to = now(), updated_at = now()
          WHERE id = $1 AND user_id = $2
            AND deleted_at IS NULL AND valid_to IS NULL
          RETURNING id
          `,
          [nearest.id, opts.userId],
        );
        if (!expired.rows[0]) {
          action = "ADD";
        } else {
          supersededId = nearest.id;
        }

        const ins = await client.query<{ id: string }>(
          `
          INSERT INTO memories (
            user_id, kind, content, embedding, importance,
            source_message_id, source_thread_id
          ) VALUES ($1, $2::memory_kind, $3, $4::vector, $5, $6, $7)
          RETURNING id
          `,
          [
            opts.userId,
            cand.kind,
            cand.content,
            vec,
            cand.importance ?? 0.5,
            opts.sourceMessageId,
            opts.threadId,
          ],
        );
        id = ins.rows[0].id;

        if (supersededId) {
          await client.query(
            `
            INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
            VALUES ($1, $2, $3, 'supersedes', $4)
            ON CONFLICT DO NOTHING
            `,
            [opts.userId, id, supersededId, Math.max(0, 1 - (l2 ?? 0))],
          );
        }
      } else if (action === "SKIP" && nearest && l2 !== null) {
        id = nearest.id;
        await client.query(
          `
          UPDATE memories
          SET last_used_at = now(), updated_at = now()
          WHERE id = $1 AND user_id = $2
            AND deleted_at IS NULL AND valid_to IS NULL
          `,
          [nearest.id, opts.userId],
        );
      }

      await client.query(
        `
        INSERT INTO memory_extraction_log (
          user_id, thread_id, source_message_id,
          candidate_content, candidate_kind, action, matched_memory_id, sim_l2
        ) VALUES ($1,$2,$3,$4,$5::memory_kind,$6::dedupe_action,$7,$8)
        `,
        [
          opts.userId,
          opts.threadId,
          opts.sourceMessageId,
          cand.content,
          cand.kind,
          action,
          id,
          l2,
        ],
      );

      return id;
    });

    results.push({
      action,
      memoryId,
      l2,
      content: cand.content,
      kind: cand.kind,
      supersededId,
    });
  }

  return results;
}
