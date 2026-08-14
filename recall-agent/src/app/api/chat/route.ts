import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";
import { embedText } from "@/lib/ai/embed";
import { streamChat, type ChatMessage } from "@/lib/ai/chat";
import { hybridRetrieve, recordMemoryHits } from "@/lib/memory/hybrid";
import { extractMemories } from "@/lib/memory/extract";
import { dedupeAndStore } from "@/lib/memory/dedupe";
import { buildSystemPrompt } from "@/lib/prompt";
import { detectReplyLocale } from "@/lib/language";
import { chatRateLimitPerMinute } from "@/lib/env";
import { logEvent, newRequestId } from "@/lib/log";
import { takeToken } from "@/lib/ratelimit";
import type { HybridHit, Message } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  threadId?: string;
  message?: string;
};

/**
 * POST /api/chat
 * Full memory loop: embed → hybrid retrieve → stream reply → extract → dedupe store.
 * Streams NDJSON lines: meta | token | done | error
 */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();
  try {
    const userId = await requireUserId();
    const limited = takeToken(`chat:${userId}`, chatRateLimitPerMinute());
    if (!limited.ok) {
      logEvent("chat.rate_limited", { requestId, userId });
      return Response.json(
        { error: "rate limited", retryAfterSec: limited.retryAfterSec },
        { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
      );
    }
    const body = (await req.json()) as Body;
    const text = body.message?.trim();
    if (!text) {
      return Response.json({ error: "message required" }, { status: 400 });
    }

    let threadId = body.threadId;
    if (!threadId) {
      const { rows } = await query<{ id: string }>(
        `INSERT INTO threads (user_id, title) VALUES ($1, $2) RETURNING id`,
        [userId, text.slice(0, 60)],
      );
      threadId = rows[0].id;
    } else {
      const { rows } = await query(
        `SELECT 1 FROM threads WHERE id = $1 AND user_id = $2`,
        [threadId, userId],
      );
      if (!rows.length) {
        return Response.json({ error: "thread not found" }, { status: 404 });
      }
    }

    const { rows: userMsgRows } = await query<Message>(
      `
      INSERT INTO messages (thread_id, user_id, role, content)
      VALUES ($1, $2, 'user', $3)
      RETURNING id, thread_id, user_id, role, content, created_at
      `,
      [threadId, userId, text],
    );
    const userMessage = userMsgRows[0];

    await query(`UPDATE threads SET updated_at = now() WHERE id = $1`, [
      threadId,
    ]);

    const tEmbed = Date.now();
    const queryEmb = await embedText(text);
    const embedMs = Date.now() - tEmbed;
    const tRetrieve = Date.now();
    const hits = await hybridRetrieve({
      userId,
      queryEmbedding: queryEmb,
      queryText: text,
      limit: 8,
    });
    const retrieveMs = Date.now() - tRetrieve;

    await recordMemoryHits({
      userId,
      threadId,
      messageId: userMessage.id,
      hits,
    });

    const { rows: history } = await query<Message>(
      `
      SELECT id, thread_id, user_id, role, content, created_at
      FROM messages
      WHERE thread_id = $1 AND user_id = $2
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [threadId, userId],
    );
    const chronological = history.reverse();
    const locale = detectReplyLocale(text);

    const chatMessages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(hits, locale) },
      ...chronological
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        };

        try {
          send({
            type: "meta",
            requestId,
            threadId,
            userMessageId: userMessage.id,
            locale,
            memories: hits.map(publicHit),
          });

          let assistantText = "";
          for await (const delta of streamChat(chatMessages)) {
            assistantText += delta;
            send({ type: "token", text: delta });
          }

          const { rows: asstRows } = await query<Message>(
            `
            INSERT INTO messages (thread_id, user_id, role, content)
            VALUES ($1, $2, 'assistant', $3)
            RETURNING id, thread_id, user_id, role, content, created_at
            `,
            [threadId, userId, assistantText],
          );
          const assistantMessage = asstRows[0];

          // P6 → P7 → P8 (async path kept in-request for demo reliability)
          let writes: Awaited<ReturnType<typeof dedupeAndStore>> = [];
          const tExtract = Date.now();
          try {
            const candidates = await extractMemories({
              userMessage: text,
              assistantMessage: assistantText,
              locale,
            });
            if (candidates.length) {
              writes = await dedupeAndStore({
                userId,
                threadId: threadId!,
                sourceMessageId: assistantMessage.id,
                candidates,
              });
            }
          } catch (extractErr) {
            send({
              type: "warn",
              message:
                extractErr instanceof Error
                  ? extractErr.message
                  : "memory extract failed",
            });
          }
          const extractMs = Date.now() - tExtract;
          const timing = {
            embedMs,
            retrieveMs,
            extractMs,
            totalMs: Date.now() - started,
          };
          logEvent("chat.done", {
            requestId,
            userId,
            threadId,
            hits: hits.length,
            add: writes.filter((w) => w.action === "ADD").length,
            update: writes.filter((w) => w.action === "UPDATE").length,
            skip: writes.filter((w) => w.action === "SKIP").length,
            ...timing,
          });

          send({
            type: "done",
            requestId,
            assistantMessageId: assistantMessage.id,
            memoryWrites: writes,
            memoriesUsed: hits.map(publicHit),
            timing,
          });
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "chat failed";
          logEvent("chat.error", { requestId, userId, message });
          send({ type: "error", requestId, message });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "chat failed";
    logEvent("chat.error", { requestId, message });
    return Response.json({ error: message, requestId }, { status: 500 });
  }
}

function publicHit(h: HybridHit) {
  return {
    id: h.id,
    kind: h.kind,
    content: h.content,
    hybrid_score: h.hybrid_score,
    score_vec: h.score_vec,
    score_txt: h.score_txt,
    score_recency: h.score_recency,
    score_usage: h.score_usage,
    hit_count: h.hit_count,
  };
}

