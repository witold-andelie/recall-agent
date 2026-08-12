import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";
import type { Message } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const userId = await requireUserId();
    const { id: threadId } = await ctx.params;

    const { rows: owned } = await query(
      `SELECT 1 FROM threads WHERE id = $1 AND user_id = $2`,
      [threadId, userId],
    );
    if (!owned.length) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const { rows } = await query<Message>(
      `
      SELECT id, thread_id, user_id, role, content, created_at
      FROM messages
      WHERE thread_id = $1 AND user_id = $2
      ORDER BY created_at ASC
      LIMIT 200
      `,
      [threadId, userId],
    );
    return NextResponse.json({ messages: rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list messages failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
