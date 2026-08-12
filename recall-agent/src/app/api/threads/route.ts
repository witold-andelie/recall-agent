import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";
import type { Thread } from "@/lib/types";

export async function GET() {
  try {
    const userId = await requireUserId();
    const { rows } = await query<Thread>(
      `
      SELECT id, user_id, title, created_at, updated_at
      FROM threads
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT 50
      `,
      [userId],
    );
    return NextResponse.json({ threads: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list threads failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const title = (body.title || "New chat").slice(0, 120);

    const { rows } = await query<Thread>(
      `
      INSERT INTO threads (user_id, title)
      VALUES ($1, $2)
      RETURNING id, user_id, title, created_at, updated_at
      `,
      [userId, title],
    );
    return NextResponse.json({ thread: rows[0] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "create thread failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
