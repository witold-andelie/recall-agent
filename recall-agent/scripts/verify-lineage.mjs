import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const base = "http://127.0.0.1:3000";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function cookieJar(headers, prev) {
  let next = prev;
  for (const c of headers.getSetCookie?.() || []) {
    const m = c.match(/recall_session=[^;]+/);
    if (m) next = m[0];
  }
  return next;
}

async function req(p, { method = "GET", cookie, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, cookie: cookieJar(res.headers, cookie) };
}

const auth = await req("/api/auth", { method: "POST" });
const cookie = auth.cookie;
const a = await req("/api/memories", {
  method: "POST",
  cookie,
  body: { content: "User prefers dark mode in the editor", kind: "preference" },
});
const b = await req("/api/memories", {
  method: "POST",
  cookie,
  body: {
    content: "User prefers dark mode in the editor UI",
    kind: "preference",
  },
});
const listed = await req("/api/memories", { cookie });

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
const live = (listed.json?.memories || []).find((m) => !m.valid_to);
if (live) {
  await pool.query(
    `UPDATE memories SET valid_to = now(), updated_at = now()
     WHERE id = $1 AND valid_to IS NULL`,
    [live.id],
  );
  const ins = await pool.query(
    `INSERT INTO memories (user_id, kind, content, importance)
     VALUES ($1, 'preference', 'User now prefers light mode in the editor', 0.7)
     RETURNING id`,
    [live.user_id],
  );
  await pool.query(
    `INSERT INTO memory_links (user_id, from_id, to_id, rel, confidence)
     VALUES ($1, $2, $3, 'supersedes', 0.8)
     ON CONFLICT DO NOTHING`,
    [live.user_id, ins.rows[0].id, live.id],
  );
}
await pool.end();

const after = await req("/api/memories", { cookie });
const afterHist = await req("/api/memories?history=1", { cookie });
const current = after.json?.memories || [];
const histRows = afterHist.json?.memories || [];
const successor = current.find((m) =>
  (m.lineage || []).some((l) => l.rel === "supersedes" && l.role === "from"),
);
const dups = (listed.json?.memories || []).filter((m) =>
  (m.lineage || []).some((l) => l.rel === "duplicates"),
);

console.log(
  JSON.stringify(
    {
      auth: auth.status,
      postA: a.status,
      postB: b.status,
      listedN: (listed.json?.memories || []).length,
      dupEdges: dups.length,
      afterCurrentN: current.length,
      afterHistN: histRows.length,
      successorReplaces: successor
        ? successor.lineage
            .filter((l) => l.rel === "supersedes")
            .map((l) => l.content.slice(0, 60))
        : null,
      expiredInCurrent: current.some((m) => m.valid_to),
      expiredInHistory: histRows.some((m) => m.valid_to),
      errors: {
        a: a.json?.error,
        b: b.json?.error,
        listed: listed.json?.error,
      },
    },
    null,
    2,
  ),
);
