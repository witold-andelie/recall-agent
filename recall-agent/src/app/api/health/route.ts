import { query, poolStats } from "@/lib/db/pool";
import { chatGateSnapshot } from "@/lib/limit";
import { instanceId } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  const instance = instanceId();
  const chat = chatGateSnapshot();
  try {
    const pool = poolStats();
    await query(`SELECT 1 AS ok`);
    return Response.json({
      ok: true,
      db: true,
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
