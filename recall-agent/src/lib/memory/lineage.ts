import { query } from "@/lib/db/pool";
import type { Memory, MemoryLineageLink } from "@/lib/types";

type LinkRow = {
  memory_id: string;
  other_id: string;
  rel: MemoryLineageLink["rel"];
  role: MemoryLineageLink["role"];
  content: string;
  valid_to: string | null;
  confidence: number;
};

export async function attachLineage<T extends Memory>(
  userId: string,
  memories: T[],
): Promise<T[]> {
  if (!memories.length) return memories;
  const ids = memories.map((m) => m.id);

  const { rows: links } = await query<LinkRow>(
    `
    SELECT
      l.from_id AS memory_id,
      l.to_id AS other_id,
      l.rel,
      'from'::STRING AS role,
      t.content,
      t.valid_to::text,
      l.confidence::float8 AS confidence
    FROM memory_links l
    INNER JOIN memories t ON t.id = l.to_id
    WHERE l.user_id = $1::uuid
      AND l.from_id = ANY($2::uuid[])
    UNION ALL
    SELECT
      l.to_id AS memory_id,
      l.from_id AS other_id,
      l.rel,
      'to'::STRING AS role,
      f.content,
      f.valid_to::text,
      l.confidence::float8 AS confidence
    FROM memory_links l
    INNER JOIN memories f ON f.id = l.from_id
    WHERE l.user_id = $1::uuid
      AND l.to_id = ANY($2::uuid[])
    `,
    [userId, ids],
  );

  const { rows: skips } = await query<{
    matched_memory_id: string;
    skip_count: number;
  }>(
    `
    SELECT matched_memory_id::text, count(*)::int AS skip_count
    FROM memory_extraction_log
    WHERE user_id = $1::uuid
      AND action = 'SKIP'
      AND matched_memory_id = ANY($2::uuid[])
    GROUP BY matched_memory_id
    `,
    [userId, ids],
  );

  const byId = new Map<string, MemoryLineageLink[]>();
  for (const row of links) {
    const list = byId.get(row.memory_id) || [];
    list.push({
      id: row.other_id,
      rel: row.rel,
      role: row.role,
      content: row.content,
      valid_to: row.valid_to,
      confidence: row.confidence,
    });
    byId.set(row.memory_id, list);
  }
  const skipById = new Map(
    skips.map((s) => [s.matched_memory_id, s.skip_count]),
  );

  return memories.map((m) => ({
    ...m,
    lineage: byId.get(m.id) || [],
    skip_count: skipById.get(m.id) || 0,
  }));
}
