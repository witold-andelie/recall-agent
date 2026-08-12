import { NextResponse } from "next/server";
import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";
import { embedText } from "@/lib/ai/embed";
import { hybridRetrieve } from "@/lib/memory/hybrid";
import { toVectorLiteral } from "@/lib/db/pool";
import type { Memory, MemoryKind } from "@/lib/types";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const kind = url.searchParams.get("kind") as MemoryKind | null;

    if (q) {
      const emb = await embedText(q);
      const hits = await hybridRetrieve({
        userId,
        queryEmbedding: emb,
        queryText: q,
        limit: 40,
      });
      return NextResponse.json({ memories: hits, mode: "hybrid" });
    }

    const params: unknown[] = [userId];
    let kindClause = "";
    if (kind) {
      params.push(kind);
      kindClause = `AND kind = $2::memory_kind`;
    }

    const { rows } = await query<Memory>(
      `
      SELECT
        id, user_id, kind, content, importance, hit_count,
        last_used_at, created_at, updated_at,
        source_message_id, source_thread_id
      FROM memories
      WHERE user_id = $1 AND deleted_at IS NULL
      ${kindClause}
      ORDER BY updated_at DESC
      LIMIT 100
      `,
      params,
    );
    return NextResponse.json({ memories: rows, mode: "list" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "list memories failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId();
    const body = (await req.json()) as {
      content?: string;
      kind?: MemoryKind;
      importance?: number;
    };
    const content = body.content?.trim();
    if (!content) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    const kind = body.kind || "fact";
    const importance = body.importance ?? 0.5;
    const emb = await embedText(content);
    const vec = toVectorLiteral(emb);

    const { rows } = await query<Memory>(
      `
      INSERT INTO memories (user_id, kind, content, embedding, importance)
      VALUES ($1, $2::memory_kind, $3, $4::vector, $5)
      RETURNING
        id, user_id, kind, content, importance, hit_count,
        last_used_at, created_at, updated_at,
        source_message_id, source_thread_id
      `,
      [userId, kind, content, vec, importance],
    );
    return NextResponse.json({ memory: rows[0] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "create memory failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    await query(
      `
      UPDATE memories
      SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      `,
      [id, userId],
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "delete memory failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
