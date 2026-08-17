import { query } from "@/lib/db/pool";
import { requireUserId } from "@/lib/session/user";
import { streamChat, type ChatMessage } from "@/lib/ai/chat";
import { completeWithTools } from "@/lib/ai/complete-tools";
import { embedText } from "@/lib/ai/embed";
import { listOpenTasks, expireOpenTasks } from "@/lib/memory/working";
import { extractMemories } from "@/lib/memory/extract";
import { dedupeAndStore } from "@/lib/memory/dedupe";
import { upsertAndLinkEntities } from "@/lib/memory/entities";
import { hybridRetrieve, recordMemoryHits } from "@/lib/memory/hybrid";
import {
  executeMemoryTools,
  formatToolResultsForModel,
} from "@/lib/memory/agent-tools";
import {
  buildAuthoritativeMemoryNote,
  listForgottenMemories,
  looksLikeRecallQuestion,
} from "@/lib/memory/forget";
import { buildSystemPrompt } from "@/lib/prompt";
import { detectReplyLocale } from "@/lib/language";
import { logEvent, newRequestId } from "@/lib/log";
import { acquireChatSlot } from "@/lib/limit";
import { instanceId } from "@/lib/env";
import type { HybridHit, Message } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = {
  threadId?: string;
  message?: string;
};

/**
 * POST /api/chat
 * Memory loop: pin open work → optional search/insert/close tools → stream → extract.
 * Streams NDJSON lines: meta | token | done | error
 */
export async function POST(req: Request) {
  const requestId = newRequestId();
  const started = Date.now();
  try {
    const userId = await requireUserId();
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

    const slot = await acquireChatSlot();
    if (!slot.ok) {
      logEvent("chat.busy", {
        requestId,
        userId,
        instance: instanceId(),
        waiting: slot.waiting,
      });
      return Response.json(
        { error: "busy", requestId, retryAfterMs: slot.waitMs },
        { status: 503, headers: { "Retry-After": "2" } },
      );
    }

    try {
    const tRetrieve = Date.now();
    let openWork = await listOpenTasks(userId);
    const forgotten = await listForgottenMemories(userId);
    const retrieveMs = Date.now() - tRetrieve;

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
      { role: "system", content: buildSystemPrompt(locale, openWork, forgotten) },
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
            memories: [],
            openWork: openWork.map(publicHit),
          });

          const tTools = Date.now();
          let searchHits: HybridHit[] = [];
          let toolWrites: Awaited<ReturnType<typeof dedupeAndStore>> = [];
          let closedByTool = false;
          let searched = false;
          const forgottenContents = forgotten.map((f) => f.content);
          try {
            for (let round = 0; round < 2; round++) {
              const step = await completeWithTools(chatMessages);
              if (!step.calls.length) break;
              if (step.calls.some((c) => c.name === "search_memory")) {
                searched = true;
              }
              const exec = await executeMemoryTools(step.calls, {
                userId,
                threadId: threadId!,
                sourceMessageId: userMessage.id,
                userMessage: text,
                forgottenContents,
              });
              searchHits = searchHits.concat(exec.searchHits);
              toolWrites = toolWrites.concat(exec.writes);
              if (exec.closed.length) closedByTool = true;
              for (const ev of exec.events) {
                send({ type: "tool", name: ev.name, output: ev.output });
              }
              chatMessages.push({
                role: "assistant",
                content: step.text || "Using memory tools.",
              });
              chatMessages.push({
                role: "user",
                content: `Memory tool results:\n${formatToolResultsForModel(exec.events)}\nAnswer the user now. Call more tools only if still needed.`,
              });
            }
            if (looksLikeRecallQuestion(text) && !searched) {
              const emb = await embedText(text);
              const hits = await hybridRetrieve({
                userId,
                queryEmbedding: emb,
                queryText: text,
                limit: 8,
              });
              await recordMemoryHits({
                userId,
                threadId: threadId!,
                messageId: userMessage.id,
                hits,
              });
              searchHits = hits;
              send({
                type: "tool",
                name: "search_memory",
                output: hits.length
                  ? hits
                      .map(
                        (h) =>
                          `[${h.kind}] ${h.content} (score=${h.hybrid_score.toFixed(3)})`,
                      )
                      .join("\n")
                  : "No matching memories.",
              });
            }
          } catch (toolErr) {
            send({
              type: "warn",
              message:
                toolErr instanceof Error
                  ? toolErr.message
                  : "memory tools failed",
            });
          }
          const toolMs = Date.now() - tTools;
          send({ type: "memories", memories: searchHits.map(publicHit) });
          const memoryNote = buildAuthoritativeMemoryNote({
            hits: searchHits,
            forgotten,
          });
          const last = chatMessages[chatMessages.length - 1];
          if (last?.role === "user") {
            last.content = `${last.content}\n\n${memoryNote}`;
          } else {
            chatMessages.push({ role: "user", content: memoryNote });
          }
          if (closedByTool) {
            openWork = [];
            send({ type: "open_work", openWork: [] });
          }

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
          let writes: Awaited<ReturnType<typeof dedupeAndStore>> = [...toolWrites];
          const tExtract = Date.now();
          try {
            const extracted = await extractMemories({
              userMessage: text,
              assistantMessage: assistantText,
              locale,
              openWork,
              forgottenContents,
            });
            if (extracted.closeOpenWork && !closedByTool) {
              const closed = await expireOpenTasks(userId);
              if (closed.length) {
                openWork = [];
                send({
                  type: "tool",
                  name: "close_open_work",
                  output: `Expired ${closed.length} open-work row(s).`,
                });
              }
            }
            if (extracted.memories.length) {
              const more = await dedupeAndStore({
                userId,
                threadId: threadId!,
                sourceMessageId: assistantMessage.id,
                candidates: extracted.memories,
                entities: extracted.entities,
              });
              writes = writes.concat(more);
            } else if (extracted.entities.length) {
              await upsertAndLinkEntities({
                userId,
                memoryIds: [],
                mentions: extracted.entities,
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
            embedMs: toolMs,
            toolMs,
            retrieveMs,
            extractMs,
            totalMs: Date.now() - started,
          };
          logEvent("chat.done", {
            requestId,
            instance: instanceId(),
            userId,
            threadId,
            hits: searchHits.length,
            tools: toolWrites.length,
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
            memories: searchHits.map(publicHit),
            memoriesUsed: searchHits.map(publicHit),
            openWork: openWork.map(publicHit),
            timing,
          });
          controller.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : "chat failed";
          logEvent("chat.error", { requestId, userId, message });
          send({ type: "error", requestId, message });
          controller.close();
        } finally {
          slot.release();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
    } catch (inner) {
      slot.release();
      throw inner;
    }
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

