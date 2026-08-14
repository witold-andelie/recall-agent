import { query } from "@/lib/db/pool";

export const runtime = "nodejs";

export async function GET() {
  const started = Date.now();
  try {
    await query(`SELECT 1 AS ok`);
    return Response.json({
      ok: true,
      db: true,
      dbMs: Date.now() - started,
    });
  } catch {
    return Response.json(
      { ok: false, db: false, dbMs: Date.now() - started },
      { status: 503 },
    );
  }
}
