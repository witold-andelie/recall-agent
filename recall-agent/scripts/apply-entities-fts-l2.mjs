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

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

const raw = fs.readFileSync(
  path.join(root, "sql", "migrate_entities_fts_l2.sql"),
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
      console.log("OK:", stmt.replace(/\s+/g, " ").slice(0, 96));
    } catch (e) {
      const msg = (e.message || String(e)).split("\n")[0];
      if (/already exists/i.test(msg)) {
        console.log("SKIP:", stmt.replace(/\s+/g, " ").slice(0, 72));
      } else {
        console.log("FAIL:", stmt.replace(/\s+/g, " ").slice(0, 96));
        console.log("  ->", msg);
        process.exitCode = 1;
      }
    }
  }

  const dummy = `[${Array(1024).fill(0).join(",")}]`;
  const uid = "00000000-0000-0000-0000-000000000001";

  const fts = await client.query(
    `EXPLAIN
     SELECT m.id
     FROM memories m
     WHERE m.user_id = $1::uuid
       AND m.deleted_at IS NULL
       AND m.valid_to IS NULL
       AND m.content_tsv @@ plainto_tsquery('simple', $2)
     ORDER BY ts_rank(m.content_tsv, plainto_tsquery('simple', $2)) DESC
     LIMIT 50`,
    [uid, "preferencias typescript"],
  );
  console.log("EXPLAIN simple FTS:");
  for (const row of fts.rows) console.log(" ", Object.values(row)[0]);

  const ent = await client.query(
    `EXPLAIN
     WITH seed AS (
       SELECT DISTINCT me.entity_id
       FROM memory_entities me
       WHERE me.user_id = $1::uuid
       LIMIT 8
     )
     SELECT m.id
     FROM memory_entities me
     INNER JOIN seed s ON s.entity_id = me.entity_id
     INNER JOIN memories m ON m.id = me.memory_id
     WHERE m.user_id = $1::uuid
       AND m.deleted_at IS NULL
       AND m.valid_to IS NULL
     LIMIT 20`,
    [uid],
  );
  console.log("EXPLAIN entity CTE:");
  for (const row of ent.rows) console.log(" ", Object.values(row)[0]);

  const calib = await client.query(`SELECT * FROM v_l2_calibration`);
  console.log("v_l2_calibration:", JSON.stringify(calib.rows[0] || {}));

  const ann = await client.query(
    `EXPLAIN
     SELECT m.id
     FROM memories@memories_user_embedding_vec_idx AS m
     WHERE m.user_id = $1::uuid
     ORDER BY m.embedding <-> $2::vector
     LIMIT 20`,
    [uid, dummy],
  );
  console.log("EXPLAIN ANN still vector search:");
  for (const row of ann.rows) console.log(" ", Object.values(row)[0]);
} finally {
  client.release();
  await pool.end();
}
