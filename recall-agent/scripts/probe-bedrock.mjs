import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const region = process.env.AWS_REGION || "us-east-1";
const client = new BedrockRuntimeClient({ region });

const chatModels = [
  "amazon.nova-lite-v1:0",
  "amazon.nova-micro-v1:0",
  "amazon.nova-pro-v1:0",
  "us.amazon.nova-lite-v1:0",
  "anthropic.claude-3-7-sonnet-20250219-v1:0",
  "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
  "anthropic.claude-sonnet-4-20250514-v1:0",
  "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
].filter((v, i, a) => v && a.indexOf(v) === i);

const embedModels = [
  process.env.BEDROCK_EMBED_MODEL,
  "amazon.titan-embed-text-v2:0",
  "amazon.titan-embed-text-v1",
].filter((v, i, a) => v && a.indexOf(v) === i);

async function tryChat(modelId) {
  try {
    const out = await client.send(
      new ConverseCommand({
        modelId,
        messages: [{ role: "user", content: [{ text: "Reply with exactly: ok" }] }],
        inferenceConfig: { maxTokens: 16, temperature: 0 },
      }),
    );
    const text = out.output?.message?.content?.map((c) => c.text || "").join("") || "";
    return { ok: true, text: text.slice(0, 80) };
  } catch (e) {
    return { ok: false, error: `${e.name || "Error"}: ${e.message}` };
  }
}

async function tryEmbed(modelId) {
  try {
    const body =
      modelId.includes("titan-embed-text-v2")
        ? { inputText: "hello memory", dimensions: 1024, normalize: true }
        : { inputText: "hello memory" };
    const out = await client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(JSON.stringify(body)),
      }),
    );
    const parsed = JSON.parse(new TextDecoder().decode(out.body));
    const n = parsed.embedding?.length ?? 0;
    return { ok: n > 0, text: `dims=${n}` };
  } catch (e) {
    return { ok: false, error: `${e.name || "Error"}: ${e.message}` };
  }
}

console.log(`region=${region}`);
console.log("=== chat ===");
for (const id of chatModels) {
  const r = await tryChat(id);
  console.log(r.ok ? `OK  ${id}  ${r.text}` : `FAIL ${id}  ${r.error}`);
}
console.log("=== embed ===");
for (const id of embedModels) {
  const r = await tryEmbed(id);
  console.log(r.ok ? `OK  ${id}  ${r.text}` : `FAIL ${id}  ${r.error}`);
}
