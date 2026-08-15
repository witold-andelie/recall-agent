import {
  ConverseCommand,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { getAiProvider } from "./config";
import { getBedrockClient } from "./bedrock";
import type { ChatMessage } from "./chat";
import { MEMORY_TOOL_SPECS, type ToolCall } from "@/lib/memory/agent-tools";

export type ToolComplete = {
  text: string;
  calls: ToolCall[];
};

function bedrockTools(): Tool[] {
  return MEMORY_TOOL_SPECS.map((t) => ({
    toolSpec: {
      name: t.name,
      description: t.description,
      inputSchema: { json: t.parameters },
    },
  })) as unknown as Tool[];
}

function openaiTools() {
  return MEMORY_TOOL_SPECS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function completeWithTools(
  messages: ChatMessage[],
): Promise<ToolComplete> {
  if (getAiProvider() === "bedrock") {
    return completeBedrockTools(messages);
  }
  return completeOpenAITools(messages);
}

async function completeBedrockTools(
  messages: ChatMessage[],
): Promise<ToolComplete> {
  const modelId =
    process.env.BEDROCK_CHAT_MODEL ||
    "us.anthropic.claude-haiku-4-5-20251001-v1:0";
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

  const out = await getBedrockClient().send(
    new ConverseCommand({
      modelId,
      system: system ? [{ text: system }] : undefined,
      messages: converseMessages,
      inferenceConfig: { temperature: 0.3, maxTokens: 1024 },
      toolConfig: { tools: bedrockTools() },
    }),
  );

  const blocks = out.output?.message?.content || [];
  let text = "";
  const calls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.text) text += block.text;
    if (block.toolUse?.name) {
      calls.push({
        id: block.toolUse.toolUseId || `tool-${calls.length}`,
        name: block.toolUse.name,
        input: (block.toolUse.input || {}) as Record<string, unknown>,
      });
    }
  }
  return { text, calls };
}

async function completeOpenAITools(
  messages: ChatMessage[],
): Promise<ToolComplete> {
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required when AI_PROVIDER=openai");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CHAT_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      messages,
      tools: openaiTools(),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Tool complete failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function?: { name: string; arguments: string };
        }>;
      };
    }>;
  };
  const msg = json.choices?.[0]?.message;
  const calls: ToolCall[] = [];
  for (const c of msg?.tool_calls || []) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(c.function?.arguments || "{}") as Record<
        string,
        unknown
      >;
    } catch {
      input = {};
    }
    calls.push({
      id: c.id,
      name: c.function?.name || "",
      input,
    });
  }
  return { text: msg?.content || "", calls };
}
