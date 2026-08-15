import { z } from "zod";
import { completeJson } from "@/lib/ai/chat";
import type { EntityMention, MemoryCandidate } from "@/lib/types";
import type { ReplyLocale } from "@/lib/language";

const Candidate = z.object({
  kind: z.enum(["preference", "fact", "task_state"]).catch("fact"),
  content: z.string().trim().min(1).max(500),
  importance: z.number().min(0).max(1).optional(),
});
const Entity = z.object({
  kind: z.enum(["person", "org", "place", "other"]).catch("other"),
  name: z.string().trim().min(1).max(80),
});
const ExtractPayload = z.object({
  memories: z.array(Candidate).max(8).optional(),
  entities: z.array(Entity).max(8).optional(),
});

export type ExtractResult = {
  memories: MemoryCandidate[];
  entities: EntityMention[];
};

/**
 * P6 — LLM proposes memory candidates + named entities.
 * SQL (dedupe) decides ADD / UPDATE / SKIP. Entity CTE aggregates the graph.
 */
export async function extractMemories(opts: {
  userMessage: string;
  assistantMessage: string;
  locale?: ReplyLocale;
  openWork?: Array<{ content: string }>;
}): Promise<ExtractResult> {
  const lang = opts.locale?.label ?? "the user's language";
  const open =
    opts.openWork?.length
      ? opts.openWork.map((t, i) => `${i + 1}. ${t.content}`).join("\n")
      : "(none)";
  const system = `You extract durable memories and named entities for an AI agent.
Return JSON:
{"memories":[{"kind":"preference"|"fact"|"task_state","content":"...","importance":0.0-1.0}],"entities":[{"kind":"person"|"org"|"place"|"other","name":"..."}]}
This product has one working loop: open work (kind=task_state).
Current open work:
${open}
Rules:
- Write each memory in the same language the user used for that fact (this turn is ${lang}).
- Do not translate into English unless the user wrote in English.
- task_state = the user's current job: goal, remaining steps, blocker, or progress. One standalone sentence that can replace the previous open-work sentence (SQL will UPDATE/supersede near-neighbors).
- If they advanced the job, emit the NEW remaining state, not a repeat of the old sentence.
- If the job is unchanged this turn, do not emit task_state.
- If they explicitly closed the job with nothing left, omit task_state (they delete it in the UI).
- preference / fact = lasting identity, not the current job.
- entities: named people, organizations/teams, places, or a named project (other). Use the name as the user wrote it. Skip pronouns, generic nouns ("the team"), and secrets.
- Max 3 memories and 4 entities. Empty arrays are fine.
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
    if (!parsed.success) return { memories: [], entities: [] };
    return {
      memories: (parsed.data.memories || []).slice(0, 3).map((m) => ({
        kind: m.kind,
        content: m.content,
        importance: m.importance ?? (m.kind === "task_state" ? 0.8 : 0.5),
      })),
      entities: (parsed.data.entities || []).slice(0, 4).map((e) => ({
        kind: e.kind,
        name: e.name,
      })),
    };
  } catch {
    return { memories: [], entities: [] };
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
