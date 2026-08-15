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
});
const raw = fs.readFileSync(
  path.join(root, "sql", "migrate_username_google.sql"),
  "utf8",
);
const stmts = raw
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
      const msg = (e.message || String(e)).split("\n")[0];
      if (/already exists/i.test(msg)) {
        console.log("SKIP:", stmt.replace(/\s+/g, " ").slice(0, 70));
      } else {
        console.log("FAIL:", msg);
        process.exitCode = 1;
      }
    }
  }
} finally {
  client.release();
  await pool.end();
}
