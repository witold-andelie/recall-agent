import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";

type ClusterRow = {
  kind: string;
  name: string;
  memory_count: number;
};

export async function GET() {
  try {
    const userId = await requireUserId();
    const { rows } = await query<ClusterRow>(
      `
      SELECT kind, name, memory_count::int
      FROM v_entity_clusters
      WHERE user_id = $1::uuid
      ORDER BY memory_count DESC, name
      LIMIT 40
      `,
      [userId],
    );
    return NextResponse.json({ entities: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list entities failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
