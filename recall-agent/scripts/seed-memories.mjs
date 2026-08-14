/**
 * Insert synthetic memories for ANN / scale demos (local hash embed, no Bedrock).
 * Usage: node scripts/seed-memories.mjs [count]
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

function hashEmbed(text, dims = 1024) {
  const vec = new Array(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const g of tokens) {
    const h = createHash("sha256").update(g).digest();
    for (let i = 0; i < 8; i++) {
      const idx = h.readUInt16BE((i * 2) % 30) % dims;
      vec[idx] += (h[i] & 1 ? 1 : -1) * ((h[i + 8] ?? 1) + 1) / 256;
    }
  }
  const n = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / n);
}

const count = Math.min(500, Math.max(1, Number(process.argv[2] || 200)));
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows: u } = await pool.query(
  `INSERT INTO users (display_name, is_anonymous)
   VALUES ('seed-bench', true)
   RETURNING id`,
);
const uid = u[0].id;
const kinds = ["preference", "fact", "task_state"];
const topics = [
  "TypeScript",
  "AWS",
  "CockroachDB",
  "concise answers",
  "dark mode",
  "vim",
  "Postgres",
  "vector search",
];

for (let i = 0; i < count; i++) {
  const kind = kinds[i % kinds.length];
  const topic = topics[i % topics.length];
  const content = `Seed ${i}: user note about ${topic} (#${i}).`;
  const emb = `[${hashEmbed(content).join(",")}]`;
  await pool.query(
    `INSERT INTO memories (user_id, kind, content, embedding, importance)
     VALUES ($1, $2::memory_kind, $3, $4::vector, 0.4)`,
    [uid, kind, content, emb],
  );
}

console.log(`seeded ${count} memories for user ${uid} (display_name=seed-bench)`);
await pool.end();
