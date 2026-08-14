import { embedText } from "@/lib/ai/embed";
import { query, toVectorLiteral, withTransaction } from "@/lib/db/pool";
import type { DedupeAction, MemoryCandidate } from "@/lib/types";

/** L2 distance thresholds — calibrate per embedding model. */
const L2_SKIP = 0.35;
const L2_UPDATE = 0.7;

export type DedupeResult = {
  action: DedupeAction;
  memoryId: string | null;
  l2: number | null;
  content: string;
  kind: string;
};

/**
 * P7 + P8 — SQL near-neighbor decides; single TX stores memory + optional link + log.
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

    const { rows: neighbors } = await query<{ id: string; l2_dist: number }>(
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
        AND m.kind = $3::memory_kind
      ORDER BY a.l2_dist
      LIMIT 1
      `,
      [opts.userId, vec, cand.kind],
    );

    const nearest = neighbors[0];
    const l2 = nearest?.l2_dist ?? null;

    let action: DedupeAction = "ADD";
    if (l2 !== null && l2 < L2_SKIP) action = "SKIP";
    else if (l2 !== null && l2 < L2_UPDATE) action = "UPDATE";

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

        if (nearest && l2 !== null && l2 < L2_UPDATE) {
          await client.query(
            `
            INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
            VALUES ($1, $2, $3, 'derived_from', $4)
            ON CONFLICT DO NOTHING
            `,
            [opts.userId, id, nearest.id, Math.max(0, 1 - l2)],
          );
        }
      } else if (action === "UPDATE" && nearest) {
        await client.query(
          `
          UPDATE memories
          SET content = $3,
              embedding = $4::vector,
              importance = GREATEST(importance, $5),
              updated_at = now(),
              source_message_id = $6,
              source_thread_id = $7
          WHERE id = $1 AND user_id = $2
          `,
          [
            nearest.id,
            opts.userId,
            cand.content,
            vec,
            cand.importance ?? 0.5,
            opts.sourceMessageId,
            opts.threadId,
          ],
        );
        id = nearest.id;
      } else if (action === "SKIP" && nearest && l2 !== null) {
        // Candidate is a near-duplicate of existing memory — no new row.
        id = nearest.id;
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
    });
  }

  return results;
}
