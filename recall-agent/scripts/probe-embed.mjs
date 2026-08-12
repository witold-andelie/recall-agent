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

function localHashEmbed(text, dims = 1024) {
  const vec = new Array(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const grams = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  for (const g of grams) {
    const h = createHash("sha256").update(g).digest();
    for (let i = 0; i < 8; i++) {
      const idx = h.readUInt16BE((i * 2) % 30) % dims;
      const sign = h[i] & 1 ? 1 : -1;
      vec[idx] += (sign * ((h[i + 8] ?? 1) + 1)) / 256;
    }
  }
  const n = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / n);
}

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const emb = localHashEmbed("I prefer concise TypeScript answers");
const lit = `[${emb.join(",")}]`;
const u = await pool.query(
  `INSERT INTO users (display_name) VALUES ('probe') RETURNING id`,
);
const uid = u.rows[0].id;
await pool.query(
  `INSERT INTO memories (user_id, kind, content, embedding, importance)
   VALUES ($1, 'preference', $2, $3::vector, 0.8)`,
  [uid, "User prefers concise TypeScript answers", lit],
);
const hit = await pool.query(
  `SELECT content, (embedding <-> $1::vector)::float8 AS d
   FROM memories WHERE user_id = $2
   ORDER BY embedding <-> $1::vector LIMIT 1`,
  [lit, uid],
);
console.log("DB embed probe OK", hit.rows[0]);
await pool.query(`DELETE FROM memories WHERE user_id = $1`, [uid]);
await pool.query(`DELETE FROM users WHERE id = $1`, [uid]);
await pool.end();
