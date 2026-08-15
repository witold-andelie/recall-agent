/**
 * Creates recall_app (no password unless RECALL_APP_PASSWORD is set) and applies grants.
 * Does not change DATABASE_URL. Set the password in Cloud Console, then point the app at recall_app.
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

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const grants = fs.readFileSync(path.join(root, "sql", "app_grants.sql"), "utf8");
const stmts = [
  "CREATE USER IF NOT EXISTS recall_app",
  ...(env.RECALL_APP_PASSWORD
    ? [`ALTER USER recall_app WITH PASSWORD '${env.RECALL_APP_PASSWORD.replace(/'/g, "''")}'`]
    : []),
  ...grants
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean),
];

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
  const who = await client.query(`SHOW GRANTS FOR recall_app`);
  console.log("grants:", who.rowCount);
} finally {
  client.release();
  await pool.end();
}
