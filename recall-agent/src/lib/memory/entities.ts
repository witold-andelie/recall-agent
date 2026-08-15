import { query } from "@/lib/db/pool";
import type { EntityMention, Memory, MemoryEntity } from "@/lib/types";

export function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function upsertAndLinkEntities(opts: {
  userId: string;
  memoryIds: string[];
  mentions: EntityMention[];
}): Promise<void> {
  const mentions = opts.mentions
    .map((m) => ({
      kind: m.kind,
      name: m.name.trim().slice(0, 80),
      name_norm: normalizeEntityName(m.name),
    }))
    .filter((m) => m.name_norm.length > 0);
  if (!mentions.length || !opts.memoryIds.length) {
    if (mentions.length) {
      for (const m of mentions) {
        await query(
          `
          INSERT INTO entities (user_id, kind, name, name_norm)
          VALUES ($1, $2::entity_kind, $3, $4)
          ON CONFLICT (user_id, kind, name_norm)
          DO UPDATE SET updated_at = now(), name = EXCLUDED.name
          `,
          [opts.userId, m.kind, m.name, m.name_norm],
        );
      }
    }
    return;
  }

  for (const m of mentions) {
    const { rows } = await query<{ id: string }>(
      `
      INSERT INTO entities (user_id, kind, name, name_norm)
      VALUES ($1, $2::entity_kind, $3, $4)
      ON CONFLICT (user_id, kind, name_norm)
      DO UPDATE SET updated_at = now(), name = EXCLUDED.name
      RETURNING id
      `,
      [opts.userId, m.kind, m.name, m.name_norm],
    );
    const entityId = rows[0]?.id;
    if (!entityId) continue;
    for (const memoryId of opts.memoryIds) {
      await query(
        `
        INSERT INTO memory_entities (user_id, memory_id, entity_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (memory_id, entity_id) DO NOTHING
        `,
        [opts.userId, memoryId, entityId],
      );
    }
  }
}

export async function attachEntities<T extends Memory>(
  userId: string,
  memories: T[],
): Promise<T[]> {
  if (!memories.length) return memories;
  const ids = memories.map((m) => m.id);
  const { rows } = await query<MemoryEntity & { memory_id: string }>(
    `
    SELECT
      me.memory_id::text,
      e.id::text,
      e.kind,
      e.name
    FROM memory_entities me
    INNER JOIN entities e ON e.id = me.entity_id
    WHERE me.user_id = $1::uuid
      AND me.memory_id = ANY($2::uuid[])
    ORDER BY e.kind, e.name
    `,
    [userId, ids],
  );
  const byId = new Map<string, MemoryEntity[]>();
  for (const row of rows) {
    const list = byId.get(row.memory_id) || [];
    list.push({ id: row.id, kind: row.kind, name: row.name });
    byId.set(row.memory_id, list);
  }
  return memories.map((m) => ({
    ...m,
    entities: byId.get(m.id) || [],
  }));
}
