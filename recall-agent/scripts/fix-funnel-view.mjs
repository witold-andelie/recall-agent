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

const sql = `
CREATE OR REPLACE VIEW v_memory_funnel AS
WITH msg AS (
  SELECT
    user_id,
    date_trunc('day', created_at) AS day,
    count(*) AS messages
  FROM messages
  WHERE role = 'user'
  GROUP BY 1, 2
),
ext AS (
  SELECT
    user_id,
    date_trunc('day', created_at) AS day,
    count(*) AS extractions,
    count(*) FILTER (WHERE action = 'ADD') AS add_n,
    count(*) FILTER (WHERE action = 'UPDATE') AS update_n,
    count(*) FILTER (WHERE action = 'SKIP') AS skip_n
  FROM memory_extraction_log
  GROUP BY 1, 2
)
SELECT
  COALESCE(m.user_id, e.user_id) AS user_id,
  COALESCE(m.day, e.day) AS day,
  COALESCE(m.messages, 0) AS messages,
  COALESCE(e.extractions, 0) AS extractions,
  COALESCE(e.add_n, 0) AS add_n,
  COALESCE(e.update_n, 0) AS update_n,
  COALESCE(e.skip_n, 0) AS skip_n,
  CASE
    WHEN COALESCE(m.messages, 0) = 0 THEN NULL
    ELSE COALESCE(e.extractions, 0)::FLOAT8 / m.messages::FLOAT8
  END AS extract_per_user_msg,
  CASE
    WHEN COALESCE(e.extractions, 0) = 0 THEN NULL
    ELSE e.add_n::FLOAT8 / e.extractions::FLOAT8
  END AS add_rate
FROM msg m
FULL OUTER JOIN ext e
  ON m.user_id = e.user_id AND m.day = e.day
`;

await pool.query(sql);
console.log("v_memory_funnel OK");
await pool.end();
