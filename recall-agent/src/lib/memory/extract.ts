import { completeJson } from "@/lib/ai/chat";
import type { MemoryCandidate, MemoryKind } from "@/lib/types";
import type { ReplyLocale } from "@/lib/language";

const KINDS: MemoryKind[] = ["preference", "fact", "task_state"];

/**
 * P6 — LLM proposes memory candidates. SQL (dedupe) decides ADD / UPDATE / SKIP.
 * Content language follows the user's fact language (not forced English).
 */
export async function extractMemories(opts: {
  userMessage: string;
  assistantMessage: string;
  locale?: ReplyLocale;
}): Promise<MemoryCandidate[]> {
  const lang = opts.locale?.label ?? "the user's language";
  const system = `You extract durable memories for an AI agent.
Return JSON: {"memories":[{"kind":"preference"|"fact"|"task_state","content":"...","importance":0.0-1.0}]}
Rules:
- Write each memory in the same language the user used for that fact (this turn is ${lang}).
- Do not translate into English unless the user wrote in English.
- Only lasting preferences, facts about the user, or task state worth recalling later.
- Skip chit-chat, one-off questions, and secrets/passwords.
- Max 3 memories. Empty array is fine.
- content must be a short standalone sentence.`;

  const raw = await completeJson([
    { role: "system", content: system },
    {
      role: "user",
      content: `User:\n${opts.userMessage}\n\nAssistant:\n${opts.assistantMessage}`,
    },
  ]);

  try {
    const parsed = JSON.parse(stripCodeFence(raw)) as {
      memories?: Array<{ kind?: string; content?: string; importance?: number }>;
    };
    const list = parsed.memories || [];
    return list
      .filter((m) => m.content && String(m.content).trim().length > 0)
      .slice(0, 3)
      .map((m) => ({
        kind: (KINDS.includes(m.kind as MemoryKind)
          ? m.kind
          : "fact") as MemoryKind,
        content: String(m.content).trim().slice(0, 500),
        importance:
          typeof m.importance === "number"
            ? Math.min(1, Math.max(0, m.importance))
            : 0.5,
      }));
  } catch {
    return [];
  }
}

function stripCodeFence(s: string): string {
  const t = s.trim();
  if (t.startsWith("```")) {
    return t
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  return t;
}
