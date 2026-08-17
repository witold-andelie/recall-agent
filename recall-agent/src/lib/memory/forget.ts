import { query } from "@/lib/db/pool";

export type ForgottenMemory = {
  id: string;
  kind: string;
  content: string;
};

const FORGET_LIMIT = 20;

/** Soft-deleted rows still in this tenant — product "forget", not chat history. */
export async function listForgottenMemories(
  userId: string,
): Promise<ForgottenMemory[]> {
  const { rows } = await query<ForgottenMemory>(
    `
    SELECT id::text, kind::text, content
    FROM memories
    WHERE user_id = $1::uuid
      AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
    LIMIT $2
    `,
    [userId, FORGET_LIMIT],
  );
  return rows;
}

/** "What do you know about my preferences?" and similar recall prompts. */
export function looksLikeRecallQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bwhat do you (know|remember)\b/.test(t) ||
    /\bwhat (are|is) my (preference|preferences|prefs)\b/.test(t) ||
    /\bmy preferences\b/.test(t) ||
    /\bdo you remember\b/.test(t) ||
    /\bsearch memory\b/.test(t) ||
    /\bwhat have you (got|stored|saved|learned|remembered)\b/.test(t)
  );
}

/**
 * Recall-only turn: asking what is stored, not stating a new fact.
 * Used to skip extract so the assistant recap cannot re-ADD a deleted row.
 */
export function isRecallOnlyTurn(text: string): boolean {
  if (!looksLikeRecallQuestion(text)) return false;
  if (text.trim().length > 180) return false;
  return !/\bi (?:prefer|like|love|hate|work|am|need|want)\b/i.test(text);
}

export function normalizeMemoryText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the user|user|they|them|their|i|i'm|im|my)\b/g, " ")
    .replace(/\b(prefers?|prefer|likes?|like|works?|work|in|on|at|a|an|the)\b/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const as = new Set(a.split(" ").filter((t) => t.length > 2));
  const bs = new Set(b.split(" ").filter((t) => t.length > 2));
  if (!as.size || !bs.size) return 0;
  let n = 0;
  for (const t of as) if (bs.has(t)) n += 1;
  return n / Math.min(as.size, bs.size);
}

/** True when `content` is the same fact as one of the forgotten sentences. */
export function isForgottenRestatement(
  content: string,
  forgotten: string[],
): boolean {
  const a = normalizeMemoryText(content);
  if (a.length < 8) return false;
  return forgotten.some((f) => {
    const b = normalizeMemoryText(f);
    if (b.length < 8) return false;
    return a.includes(b) || b.includes(a) || tokenOverlap(a, b) >= 0.72;
  });
}

export function buildAuthoritativeMemoryNote(opts: {
  hits: Array<{ kind: string; content: string }>;
  forgotten: Array<{ kind: string; content: string }>;
}): string {
  const live = opts.hits.length
    ? opts.hits.map((h, i) => `${i + 1}. [${h.kind}] ${h.content}`).join("\n")
    : "(none — search returned no live rows)";
  const gone = opts.forgotten.length
    ? opts.forgotten
        .map((h, i) => `${i + 1}. [${h.kind}] ${h.content}`)
        .join("\n")
    : "(none)";
  return `Authoritative durable memory for THIS turn (CockroachDB, not chat history):
${live}

Forgotten — deleted in /memory. Do not use, even if earlier messages in this thread mention them:
${gone}

Use only this-turn user text + the live list + pinned open work. Chat history is not a memory store. If the live list is empty and this turn does not newly state a fact, say you do not know. Do not call insert_memory to restore a forgotten item unless the user stated it again in THIS message.`;
}
