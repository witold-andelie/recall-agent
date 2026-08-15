import { query, poolStats } from "@/lib/db/pool";
import { chatGateSnapshot } from "@/lib/limit";
import { instanceId } from "@/lib/env";

export const runtime = "nodejs";

/** Cockroach readiness. 503 if SQL or schema is unreachable. */
export async function GET() {
  const started = Date.now();
  const instance = instanceId();
  const chat = chatGateSnapshot();
  try {
    const pool = poolStats();
    await query(`SELECT 1 AS ok`);
    await query(`SELECT 1 FROM auth_tokens LIMIT 0`);
    return Response.json({
      ok: true,
      db: true,
      schema: true,
      dbMs: Date.now() - started,
      instance,
      pool,
      chat,
    });
  } catch {
    return Response.json(
      {
        ok: false,
        db: false,
        dbMs: Date.now() - started,
        instance,
        chat,
      },
      { status: 503 },
    );
  }
}
