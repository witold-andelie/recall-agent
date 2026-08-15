import { query } from "@/lib/db/pool";
import type { HybridHit, Memory } from "@/lib/types";

const OPEN_WORK_LIMIT = 5;

/**
 * Vertical loop: live task_state is working memory, pinned every turn.
 * Hybrid search can miss it (query is "what's left?" with weak lexical overlap).
 */
export async function listOpenTasks(userId: string): Promise<HybridHit[]> {
  const { rows } = await query<Memory>(
    `
    SELECT
      id, user_id, kind, content, importance, hit_count,
      last_used_at, created_at, updated_at,
      source_message_id, source_thread_id, valid_to
    FROM memories
    WHERE user_id = $1::uuid
      AND kind = 'task_state'::memory_kind
      AND deleted_at IS NULL
      AND valid_to IS NULL
    ORDER BY updated_at DESC
    LIMIT $2
    `,
    [userId, OPEN_WORK_LIMIT],
  );

  return rows.map((m) => ({
    ...m,
    score_vec: 0,
    score_txt: 0,
    score_recency: 1,
    score_usage: 0,
    hybrid_score: 1,
  }));
}

/** Close the vertical loop: expire every live task_state for this tenant. */
export async function expireOpenTasks(userId: string): Promise<
  Array<{ id: string; content: string }>
> {
  const { rows } = await query<{ id: string; content: string }>(
    `
    UPDATE memories
    SET valid_to = now(), updated_at = now()
    WHERE user_id = $1::uuid
      AND kind = 'task_state'::memory_kind
      AND deleted_at IS NULL
      AND valid_to IS NULL
    RETURNING id, content
    `,
    [userId],
  );
  return rows;
}

export function mergeWorkingSet(
  hits: HybridHit[],
  openWork: HybridHit[],
): HybridHit[] {
  if (!openWork.length) return hits;
  const pinned = new Set(openWork.map((t) => t.id));
  return [...openWork, ...hits.filter((h) => !pinned.has(h.id))];
}
