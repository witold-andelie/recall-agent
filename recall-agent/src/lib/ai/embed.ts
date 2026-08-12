import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { createHash } from "crypto";
import { getAiProvider, normalizeEmbedding, embeddingDims } from "./config";

/**
 * Embed text → VECTOR(n).
 * Providers:
 *  - EMBEDDING_PROVIDER=local  (default if set) — deterministic local hash embed
 *  - AI_PROVIDER=bedrock       — Titan
 *  - otherwise                 — OpenAI-compatible /embeddings
 */
export async function embedText(text: string): Promise<number[]> {
  const input = text.trim().slice(0, 8000);
  if (!input) {
    return normalizeEmbedding([]);
  }

  const provider = (
    process.env.EMBEDDING_PROVIDER ||
    (getAiProvider() === "bedrock" ? "bedrock" : "openai")
  ).toLowerCase();

  if (provider === "local") {
    return localHashEmbed(input);
  }
  if (provider === "bedrock") {
    return embedBedrock(input);
  }
  return embedOpenAI(input);
}

/**
 * Lightweight deterministic embedding for demos when the LLM provider
 * has no embeddings API. Not SOTA semantic quality,
 * but stable L2 distances + works with CRDB VECTOR + hybrid SQL path.
 */
function localHashEmbed(text: string): number[] {
  const dims = embeddingDims();
  const vec = new Array<number>(dims).fill(0);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const tokens = normalized.split(/\s+/).filter(Boolean);

  // unigrams + bigrams
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  if (grams.length === 0) grams.push(text);

  for (const g of grams) {
    const h = createHash("sha256").update(g).digest();
    for (let i = 0; i < 8; i++) {
      const idx = h.readUInt16BE((i * 2) % 30) % dims;
      const sign = h[i] & 1 ? 1 : -1;
      const mag = ((h[i + 8] ?? 1) + 1) / 256;
      vec[idx] += sign * mag;
    }
  }

  // L2 normalize
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

async function embedOpenAI(text: string): Promise<number[]> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required when embedding via openai");

  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const dims = embeddingDims();
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      ...(model.includes("text-embedding-3") ? { dimensions: dims } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // Fallback so chat path still works if provider is chat-only
    if (res.status === 404 || res.status === 400 || res.status === 402) {
      console.warn(
        `[embed] remote embeddings failed (${res.status}), using local hash embed`,
      );
      return localHashEmbed(text);
    }
    throw new Error(`Embedding failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return normalizeEmbedding(json.data[0].embedding, dims);
}

async function embedBedrock(text: string): Promise<number[]> {
  const region = process.env.AWS_REGION || "us-east-1";
  const modelId =
    process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0";
  const client = new BedrockRuntimeClient({ region });

  const dims = embeddingDims();
  const body = JSON.stringify({
    inputText: text,
    dimensions: dims,
    normalize: true,
  });

  const out = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(body),
    }),
  );

  const parsed = JSON.parse(new TextDecoder().decode(out.body)) as {
    embedding?: number[];
  };
  if (!parsed.embedding?.length) {
    throw new Error("Bedrock embedding response missing embedding");
  }
  return normalizeEmbedding(parsed.embedding, dims);
}
