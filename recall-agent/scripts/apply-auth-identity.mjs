import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvLocal() {
  const p = path.join(root, ".env.local");
  const text = fs.readFileSync(p, "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

const env = loadEnvLocal();
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

const raw = fs.readFileSync(
  path.join(root, "sql", "migrate_auth_identity.sql"),
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

  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
    ORDER BY ordinal_position
  `);
  console.log(
    "users columns:",
    cols.rows.map((r) => `${r.column_name}:${r.data_type}`).join(", "),
  );

  const explain = await client.query(
    `EXPLAIN SELECT id FROM users WHERE email = $1 LIMIT 1`,
    ["judge@example.com"],
  );
  console.log("EXPLAIN login lookup:");
  for (const row of explain.rows) {
    console.log(" ", Object.values(row)[0]);
  }
} finally {
  client.release();
  await pool.end();
}
