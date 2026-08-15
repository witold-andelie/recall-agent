import { embedText } from "@/lib/ai/embed";
import { hybridRetrieve, recordMemoryHits } from "@/lib/memory/hybrid";
import { dedupeAndStore, type DedupeResult } from "@/lib/memory/dedupe";
import { expireOpenTasks } from "@/lib/memory/working";
import type { HybridHit, MemoryKind } from "@/lib/types";

export const MEMORY_TOOL_NAMES = [
  "search_memory",
  "insert_memory",
  "close_open_work",
] as const;

export type MemoryToolName = (typeof MEMORY_TOOL_NAMES)[number];

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolEvent = {
  name: string;
  input: Record<string, unknown>;
  output: string;
};

export const MEMORY_TOOL_SPECS = [
  {
    name: "search_memory",
    description:
      "Search this user's durable memories with hybrid SQL (vector L2 + full-text + entity hop). Use when you need facts or preferences that are not in open work.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search, in the user's language",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "insert_memory",
    description:
      "Store a durable memory. SQL decides ADD, UPDATE (versioned), or SKIP.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: {
          type: "string",
          enum: ["preference", "fact", "task_state"],
        },
      },
      required: ["content"],
    },
  },
  {
    name: "close_open_work",
    description:
      "Expire every live task_state for this user. Call when they finished or cancelled the job and nothing remains.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
    },
  },
];

export type ToolExecContext = {
  userId: string;
  threadId: string;
  sourceMessageId: string;
};

export type ToolExecBundle = {
  events: ToolEvent[];
  searchHits: HybridHit[];
  writes: DedupeResult[];
  closed: Array<{ id: string; content: string }>;
};

export async function executeMemoryTools(
  calls: ToolCall[],
  ctx: ToolExecContext,
): Promise<ToolExecBundle> {
  const bundle: ToolExecBundle = {
    events: [],
    searchHits: [],
    writes: [],
    closed: [],
  };

  for (const call of calls) {
    const name = call.name;
    try {
      if (name === "search_memory") {
        const q = String(call.input.query || "").trim();
        if (!q) {
          bundle.events.push({
            name,
            input: call.input,
            output: "query required",
          });
          continue;
        }
        const emb = await embedText(q);
        const hits = await hybridRetrieve({
          userId: ctx.userId,
          queryEmbedding: emb,
          queryText: q,
          limit: 8,
        });
        await recordMemoryHits({
          userId: ctx.userId,
          threadId: ctx.threadId,
          messageId: ctx.sourceMessageId,
          hits,
        });
        bundle.searchHits.push(...hits);
        bundle.events.push({
          name,
          input: call.input,
          output: hits.length
            ? hits
                .map(
                  (h) =>
                    `[${h.kind}] ${h.content} (score=${h.hybrid_score.toFixed(3)})`,
                )
                .join("\n")
            : "No matching memories.",
        });
      } else if (name === "insert_memory") {
        const content = String(call.input.content || "").trim();
        const kind = (String(call.input.kind || "fact") || "fact") as MemoryKind;
        if (!content) {
          bundle.events.push({
            name,
            input: call.input,
            output: "content required",
          });
          continue;
        }
        const writes = await dedupeAndStore({
          userId: ctx.userId,
          threadId: ctx.threadId,
          sourceMessageId: ctx.sourceMessageId,
          candidates: [
            {
              kind: ["preference", "fact", "task_state"].includes(kind)
                ? kind
                : "fact",
              content,
              importance: kind === "task_state" ? 0.8 : 0.5,
            },
          ],
        });
        bundle.writes.push(...writes);
        bundle.events.push({
          name,
          input: call.input,
          output: writes
            .map((w) => `${w.action} ${w.kind}: ${w.content}`)
            .join("\n"),
        });
      } else if (name === "close_open_work") {
        const closed = await expireOpenTasks(ctx.userId);
        bundle.closed.push(...closed);
        bundle.events.push({
          name,
          input: call.input,
          output: closed.length
            ? `Expired ${closed.length} open-work row(s).`
            : "No live task_state to close.",
        });
      } else {
        bundle.events.push({
          name,
          input: call.input,
          output: `unknown tool ${name}`,
        });
      }
    } catch (e) {
      bundle.events.push({
        name,
        input: call.input,
        output: e instanceof Error ? e.message : "tool failed",
      });
    }
  }

  return bundle;
}

export function formatToolResultsForModel(events: ToolEvent[]): string {
  if (!events.length) return "No memory tools ran.";
  return events
    .map(
      (e) =>
        `${e.name} ${JSON.stringify(e.input)}\n${e.output}`,
    )
    .join("\n\n");
}
