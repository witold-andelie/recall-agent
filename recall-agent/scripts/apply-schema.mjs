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

function stripSql(sql) {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, "\n");
  s = s.replace(/--[^\n]*/g, "");
  return s;
}

function splitStatements(sql) {
  return sql
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.length > 0 && !/^(BEGIN|COMMIT)$/i.test(x));
}

const env = loadEnvLocal();
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

const client = await pool.connect();
try {
  try {
    await client.query(
      "SET CLUSTER SETTING feature.vector_index.enabled = true",
    );
    console.log("vector_index: enabled");
  } catch (e) {
    console.log("vector_index setting:", e.message.split("\n")[0]);
  }

  const raw = fs.readFileSync(path.join(root, "sql", "schema_v3.sql"), "utf8");
  const stmts = splitStatements(stripSql(raw));
  let ok = 0;
  let skip = 0;
  let fail = 0;

  for (const stmt of stmts) {
    try {
      await client.query(stmt);
      ok++;
      console.log("OK:", stmt.replace(/\s+/g, " ").slice(0, 72));
    } catch (e) {
      const msg = e.message || "";
      if (/already exists/i.test(msg)) {
        skip++;
        console.log("SKIP:", stmt.replace(/\s+/g, " ").slice(0, 50));
      } else {
        fail++;
        console.log("FAIL:", stmt.replace(/\s+/g, " ").slice(0, 72));
        console.log("  ->", msg.split("\n")[0]);
      }
    }
  }

  console.log(JSON.stringify({ ok, skip, fail, total: stmts.length }));

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY 1`,
  );
  console.log(
    "tables:",
    tables.rows.map((r) => r.table_name).join(", "),
  );
} finally {
  client.release();
  await pool.end();
}
