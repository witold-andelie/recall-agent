import { z } from "zod";
import { completeJson } from "@/lib/ai/chat";
import type { MemoryCandidate } from "@/lib/types";
import type { ReplyLocale } from "@/lib/language";

const Candidate = z.object({
  kind: z.enum(["preference", "fact", "task_state"]).catch("fact"),
  content: z.string().trim().min(1).max(500),
  importance: z.number().min(0).max(1).optional(),
});
const ExtractPayload = z.object({
  memories: z.array(Candidate).max(8).optional(),
});

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
    const parsed = ExtractPayload.safeParse(JSON.parse(stripCodeFence(raw)));
    if (!parsed.success) return [];
    return (parsed.data.memories || []).slice(0, 3).map((m) => ({
      kind: m.kind,
      content: m.content,
      importance: m.importance ?? 0.5,
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
