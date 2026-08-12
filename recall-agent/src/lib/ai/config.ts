export type AiProvider = "bedrock" | "openai";

export function getAiProvider(): AiProvider {
  const p = (process.env.AI_PROVIDER || "openai").toLowerCase();
  return p === "bedrock" ? "bedrock" : "openai";
}

export function embeddingDims(): number {
  return Number(process.env.EMBEDDING_DIMS || "1024");
}

/** Pad or truncate embedding to match VECTOR(n) schema. */
export function normalizeEmbedding(vec: number[], dims = embeddingDims()): number[] {
  if (vec.length === dims) return vec;
  if (vec.length > dims) return vec.slice(0, dims);
  return vec.concat(new Array(dims - vec.length).fill(0));
}
