import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";

export const runtime = "nodejs";

type FunnelRow = {
  day: string;
  messages: number;
  extractions: number;
  add_n: number;
  update_n: number;
  skip_n: number;
};

export async function GET() {
  try {
    const userId = await requireUserId();
    const { rows } = await query<FunnelRow>(
      `
      SELECT
        day::text,
        messages::int,
        extractions::int,
        add_n::int,
        update_n::int,
        skip_n::int
      FROM v_memory_funnel
      WHERE user_id = $1::uuid
      ORDER BY day DESC
      LIMIT 7
      `,
      [userId],
    );
    return Response.json({ days: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "funnel failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
