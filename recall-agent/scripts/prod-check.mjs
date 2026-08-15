/**
 * Production readiness probe against CockroachDB Cloud (no Bedrock).
 * Usage: node scripts/prod-check.mjs
 */
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

const need = [
  "users",
  "auth_sessions",
  "auth_tokens",
  "threads",
  "messages",
  "memories",
  "memory_links",
  "entities",
  "memory_entities",
  "memory_extraction_log",
];
const views = [
  "v_memory_funnel",
  "v_memory_reuse",
  "v_entity_clusters",
  "v_l2_calibration",
];

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const fail = [];
const ok = [];
try {
  await pool.query("SELECT 1");
  ok.push("connect");

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const have = new Set(tables.rows.map((r) => r.table_name));
  for (const t of need) {
    if (have.has(t)) ok.push(`table:${t}`);
    else fail.push(`missing table ${t}`);
  }
  for (const v of views) {
    if (have.has(v)) ok.push(`view:${v}`);
    else fail.push(`missing view ${v}`);
  }

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users' AND column_name IN ('username','google_sub')`,
  );
  if (cols.rowCount >= 2) ok.push("users.identity");
  else fail.push("users missing username/google_sub");

  const dummy = `[${Array(1024).fill(0).join(",")}]`;
  const plan = await pool.query(
    `EXPLAIN SELECT m.id
     FROM memories@memories_user_embedding_vec_idx AS m
     WHERE m.user_id = $1::uuid
     ORDER BY m.embedding <-> $2::vector
     LIMIT 8`,
    ["00000000-0000-0000-0000-000000000001", dummy],
  );
  const text = plan.rows.map((r) => Object.values(r)[0]).join("\n");
  if (/vector search/i.test(text)) ok.push("ann:vector search");
  else fail.push("ANN plan missing vector search");

  await pool.query(`SELECT * FROM v_l2_calibration`);
  ok.push("v_l2_calibration readable");
} catch (e) {
  fail.push(e instanceof Error ? e.message : String(e));
} finally {
  await pool.end();
}

console.log(JSON.stringify({ ok, fail }, null, 2));
if (fail.length) process.exit(1);
