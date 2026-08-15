import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
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

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

const raw = fs.readFileSync(
  path.join(root, "sql", "migrate_memory_versions.sql"),
  "utf8",
);
const stmts = raw
  .replace(/\/\*[\s\S]*?\*\//g, "\n")
  .replace(/--[^\n]*/g, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const client = await pool.connect();
try {
  for (const stmt of stmts) {
    try {
      await client.query(stmt);
      console.log("OK:", stmt.replace(/\s+/g, " ").slice(0, 90));
    } catch (e) {
      console.log("FAIL:", stmt.replace(/\s+/g, " ").slice(0, 90));
      console.log("  ->", (e.message || String(e)).split("\n")[0]);
      process.exitCode = 1;
    }
  }

  const explain = await client.query(
    `
    EXPLAIN
    SELECT a.id, a.l2_dist
    FROM (
      SELECT m.id, (m.embedding <-> $2::vector)::float8 AS l2_dist
      FROM memories@memories_user_embedding_vec_idx AS m
      WHERE m.user_id = $1::uuid
      ORDER BY m.embedding <-> $2::vector
      LIMIT 20
    ) a
    INNER JOIN memories m ON m.id = a.id
    WHERE m.deleted_at IS NULL
      AND m.valid_to IS NULL
      AND m.kind = $3::memory_kind
    ORDER BY a.l2_dist
    LIMIT 1
    `,
    [
      "00000000-0000-0000-0000-000000000001",
      `[${Array(1024).fill(0).join(",")}]`,
      "fact",
    ],
  );
  console.log("EXPLAIN nearest current:");
  for (const row of explain.rows) console.log(" ", Object.values(row)[0]);
} finally {
  client.release();
  await pool.end();
}
