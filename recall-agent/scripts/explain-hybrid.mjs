/**
 * cockroachdb-sql (official skill): EXPLAIN every generated CRDB statement.
 * cockroach CLI is not installed here; same cluster via pg wire (DATABASE_URL).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(root, "..");
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

const dummy = "[" + Array(1024).fill(0).join(",") + "]";
const { rows: users } = await pool.query(
  `SELECT user_id::text AS uid FROM memories WHERE embedding IS NOT NULL LIMIT 1`,
);
if (!users[0]) {
  console.error("no memories with embeddings");
  process.exit(1);
}
const uid = users[0].uid;

async function explain(sql, params) {
  const plan = await pool.query(`EXPLAIN ${sql}`, params);
  return plan.rows.map((r) => Object.values(r).join(" ")).join("\n");
}

const annSql = `
SELECT m.id
FROM memories@memories_user_embedding_vec_idx AS m
WHERE m.user_id = $1::uuid
ORDER BY m.embedding <-> $2::vector
LIMIT 80
`;

const ann = await explain(annSql, [uid, dummy]);
await pool.end();

const used = /vector search/i.test(ann);
const md = `# Hybrid ANN — EXPLAIN (cockroachdb-sql)

Skill: \`vendor/cockroachdb-skills/skills/cockroachdb-query-and-schema-design/cockroachdb-sql\`

Rules applied:
- \`00-fundamental-principles.md\` — UUID tenant key, no sequential hotspot
- \`04-optimization.md\` — index hint \`table@index\`; EXPLAIN required
- Query shape is prefix-only (\`user_id\` + \`<->\`) so CRDB plans **vector search**

Connection: CockroachDB Cloud via \`pg\` wire (\`DATABASE_URL\`). \`cockroach\` CLI is not installed on this machine.

Captured: ${new Date().toISOString()}
Sample \`user_id\`: \`${uid}\`
Vector search in plan: **${used ? "yes" : "NO — fix the SQL"}**

## Statement

\`\`\`sql
${annSql.trim()}
\`\`\`

## EXPLAIN

\`\`\`
${ann}
\`\`\`
`;

const out = path.join(repo, "docs", "explain-hybrid-ann.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(used ? "VECTOR SEARCH ok" : "MISSING vector search");
console.log("wrote", out);
