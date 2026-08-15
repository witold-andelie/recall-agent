import { ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { getAiProvider } from "./config";
import { getBedrockClient } from "./bedrock";

export type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

/**
 * Stream assistant tokens as an async generator of text deltas.
 */
export async function* streamChat(
  messages: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  if (getAiProvider() === "bedrock") {
    yield* streamBedrock(messages);
    return;
  }
  yield* streamOpenAI(messages);
}

async function* streamOpenAI(
  messages: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");

  const model = process.env.CHAT_MODEL || "gpt-4o-mini";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      temperature: 0.4,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`Chat failed: ${res.status} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore partial JSON
      }
    }
  }
}

async function* streamBedrock(
  messages: ChatMessage[],
): AsyncGenerator<string, void, unknown> {
  const modelId =
    process.env.BEDROCK_CHAT_MODEL ||
    "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  const client = getBedrockClient();

  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const converseMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: [{ text: m.content }],
    }));

  const stream = await client.send(
    new ConverseStreamCommand({
      modelId,
      system: system ? [{ text: system }] : undefined,
      messages: converseMessages,
      inferenceConfig: { temperature: 0.4, maxTokens: 2048 },
    }),
  );

  if (!stream.stream) return;

  for await (const event of stream.stream) {
    const text = event.contentBlockDelta?.delta?.text;
    if (text) yield text;
  }
}

/** Non-streaming completion for memory extraction. */
export async function completeJson(messages: ChatMessage[]): Promise<string> {
  if (getAiProvider() === "bedrock") {
    // Reuse stream and join for simplicity
    let out = "";
    for await (const d of streamBedrock(messages)) out += d;
    return out;
  }

  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");

  const model = process.env.CHAT_MODEL || "gpt-4o-mini";
  // Some OpenAI-compatible gateways do not support response_format
  const payload: Record<string, unknown> = {
    model,
    temperature: 0.1,
    messages: [
      ...messages,
      {
        role: "system",
        content: "Respond with valid JSON only. No markdown fences.",
      },
    ],
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Complete failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return json.choices[0]?.message?.content || "{}";
}
